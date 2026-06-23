/**
 * learn_conventions — read an existing project's pages/fixtures/specs/runner config
 * and detect the conventions it already uses, so generation can match the house
 * style instead of imposing the engine's defaults.
 *
 * PR 1 is detection-only: pure, unit-testable detectors + a tool that writes a
 * human-readable workspace/PROJECT_CONVENTIONS.md report. Later phases feed the
 * detected hierarchy into config.pom and a generation-prompt conventions block.
 *
 * Parsing is regex/heuristic (reuses pom-index.ts's parsers) — no AST dependency.
 */
import { readdir, readFile } from 'fs/promises';
import { dirname, join, normalize } from 'path';
import { safeWrite } from '../lib/safe-write.js';
import { validate } from '../config-schema.js';
import { WORKSPACE_PATHS, ensureWorkspace } from '../workspace.js';
import { errorContent } from '../lib/format-error.js';
import { buildPomIndex, extractPomLocators, extractPomMethods, type PomIndexEntry, type PomMethod } from './pom-index.js';

const ROOT = process.cwd();

// Locator/method names that signal a class owns site-wide chrome (nav/header/footer).
const NAV_HINT_RE = /nav|header|footer|logo|menu|subscri|loggedin|cart|signup|login|logout|account/i;

export interface PomHierarchy {
  /** Root of the dominant inheritance tree (pages with no nav, just `navigate`). */
  baseClass: string;
  /** Ancestor that owns site-wide nav/header locators (may equal baseClass). */
  siteClass: string;
  /** True when the site nav lives on the root itself (base === site). */
  collapsed: boolean;
  intermediateClasses: { name: string; importFrom: string; extendsClass?: string; provides: string[] }[];
  /** Locator field + method names declared on the site class. */
  siteClassProvides: string[];
  leafPages: string[];
  /** Composition objects under pages/components/. */
  components: string[];
}

/** Extract `readonly <name>: Locator` field names (catches getByRole/filter locators that extractPomLocators misses). */
export function extractLocatorFieldNames(content: string): string[] {
  return [...content.matchAll(/readonly\s+(\w+)\s*:\s*Locator\b/g)].map((m) => m[1]);
}

function navSignalCount(content: string): number {
  const names = [...extractLocatorFieldNames(content), ...extractPomLocators(content).map((l) => l.name)];
  return new Set(names.filter((n) => NAV_HINT_RE.test(n))).size;
}

/**
 * Derive the POM hierarchy from pages/*.ts. Handles both shapes:
 *  - two-tier BasePage → SitePage (nav on SitePage), and
 *  - "collapsed" where the root itself carries the nav (base === site).
 */
export function detectPomHierarchy(
  pages: { name: string; content: string }[],
  componentClassNames: string[] = [],
): PomHierarchy | null {
  const entries = buildPomIndex(pages);
  if (entries.length === 0) return null;

  const byName = new Map<string, PomIndexEntry>(entries.map((e) => [e.className, e]));
  const known = new Set(byName.keys());

  // Count transitive descendants so the dominant root and the leaves fall out.
  const childrenOf = new Map<string, string[]>();
  for (const e of entries) {
    if (e.extendsClass && known.has(e.extendsClass)) {
      const kids = childrenOf.get(e.extendsClass) ?? [];
      kids.push(e.className);
      childrenOf.set(e.extendsClass, kids);
    }
  }
  const descendantCount = (name: string): number => {
    const kids = childrenOf.get(name) ?? [];
    return kids.reduce((n, k) => n + 1 + descendantCount(k), 0);
  };

  // Roots: classes that don't extend another known class. Base = root with the most descendants.
  const roots = entries.filter((e) => !e.extendsClass || !known.has(e.extendsClass));
  const baseEntry = [...roots].sort((a, b) => descendantCount(b.className) - descendantCount(a.className))[0]
    ?? entries[0];
  const baseClass = baseEntry.className;

  // Ancestors = any class with ≥1 descendant (candidates to own the nav).
  const ancestors = entries.filter((e) => (childrenOf.get(e.className) ?? []).length > 0);
  const navCandidates = (ancestors.length > 0 ? ancestors : [baseEntry])
    .map((e) => ({ entry: e, nav: navSignalCount(contentOf(pages, e.file)) }))
    .sort((a, b) => b.nav - a.nav);
  const siteEntry = (navCandidates[0]?.nav ?? 0) > 0 ? navCandidates[0].entry : baseEntry;
  const siteClass = siteEntry.className;
  const collapsed = siteClass === baseClass;

  const isAncestor = (name: string) => (childrenOf.get(name) ?? []).length > 0;
  const intermediateClasses = entries
    .filter((e) => e.className !== baseClass && e.className !== siteClass && isAncestor(e.className))
    .map((e) => {
      const content = contentOf(pages, e.file);
      return {
        name: e.className,
        importFrom: `./${e.file.replace(/^pages\//, '').replace(/\.ts$/, '')}`,
        extendsClass: e.extendsClass,
        provides: [...new Set([...extractLocatorFieldNames(content), ...e.methods.map((m) => m.name)])],
      };
    });

  const siteContent = contentOf(pages, siteEntry.file);
  const siteClassProvides = [
    ...new Set([...extractLocatorFieldNames(siteContent), ...siteEntry.methods.map((m) => m.name)]),
  ];

  const leafPages = entries.filter((e) => (childrenOf.get(e.className) ?? []).length === 0).map((e) => e.className);

  return { baseClass, siteClass, collapsed, intermediateClasses, siteClassProvides, leafPages, components: componentClassNames };
}

function contentOf(pages: { name: string; content: string }[], file: string): string {
  return pages.find((p) => p.name === file || p.name.endsWith(`/${file}`) || file.endsWith(p.name))?.content ?? '';
}

/** The shape of mcp-qa.config.json's `pom` section (mirrors config-schema's MqaConfig['pom']). */
export interface PomConfig {
  baseClass: string;
  siteClass: string;
  siteClassProvides: string[];
  intermediateClasses: { name: string; importFrom: string; description: string; paths: string[]; provides: string[] }[];
}

/**
 * Map a detected hierarchy to a config `pom` block. Pure. `existing` is the current
 * config.pom (if any) so human-authored `description`/`paths` — which can't be
 * detected from code — are preserved per intermediate class.
 */
export function buildPomConfig(h: PomHierarchy, existing?: Partial<PomConfig>): PomConfig {
  const prior = new Map((existing?.intermediateClasses ?? []).map((ic) => [ic.name, ic]));
  return {
    baseClass: h.baseClass,
    siteClass: h.siteClass,
    siteClassProvides: h.siteClassProvides,
    intermediateClasses: h.intermediateClasses.map((ic) => {
      const kept = prior.get(ic.name);
      return {
        name: ic.name,
        importFrom: ic.importFrom,
        description: kept?.description || `${ic.name} (detected — describe the pages it covers)`,
        paths: kept?.paths ?? [],
        provides: ic.provides,
      };
    }),
  };
}

export interface FixtureShape {
  exportsTest: boolean;
  exportsExpect: boolean;
  injectedFixtures: { name: string; type: string }[];
  baseExtension: string | null;
  hasTrackCleanup: boolean;
}

/** Parse fixtures/index.ts: exported test/expect, the injected fixtures, the base extension, trackCleanup. */
export function detectFixtureShape(content: string): FixtureShape {
  const exportsTest = /export\s+const\s+test\b/.test(content) || /export\s*\{[^}]*\btest\b[^}]*\}/.test(content);
  const exportsExpect = /export\s*\{[^}]*\bexpect\b[^}]*\}/.test(content);

  const injectedFixtures: { name: string; type: string }[] = [];
  const typeBlock = content.match(/type\s+\w+\s*=\s*\{([\s\S]*?)\n\}/);
  if (typeBlock) {
    for (const m of typeBlock[1].matchAll(/^\s*(\w+)\s*:\s*([^;]+);/gm)) {
      injectedFixtures.push({ name: m[1], type: m[2].trim() });
    }
  }

  const baseImport = content.match(/import\s*\{[^}]*\btest\s+as\s+base\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/);
  return {
    exportsTest,
    exportsExpect,
    injectedFixtures,
    baseExtension: baseImport ? baseImport[1] : null,
    hasTrackCleanup: /\btrackCleanup\b/.test(content),
  };
}

/** The injected fixture that wraps an API-client abstraction (e.g. `apiClient: ApiClient`), if any. */
export function findApiClientFixture(fixtures: FixtureShape | null): { name: string; type: string } | null {
  if (!fixtures) return null;
  return fixtures.injectedFixtures.find(
    (f) => /client/i.test(f.type) || /^api/i.test(f.name) || /apiclient/i.test(f.name),
  ) ?? null;
}

/**
 * Resolve `import { ClassName } from '<path>'` in the fixtures module to a
 * project-root-relative .ts path. `fixturesDir` is the directory the fixtures file
 * lives in (default "fixtures"), so a non-standard location (e.g. "support") resolves
 * its relative imports correctly.
 */
export function resolveClassImport(fixturesContent: string, className: string, fixturesDir = 'fixtures'): string | null {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = fixturesContent.match(new RegExp(`import\\s*\\{[^}]*\\b${esc}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`));
  if (!m) return null;
  return normalize(join(fixturesDir, m[1])).replace(/\.ts$/, '') + '.ts';
}

const POM_DIR_CANDIDATES = ['pages', 'src/pages', 'e2e/pages', 'tests/pages'];
const FIXTURES_CANDIDATES = ['fixtures/index.ts', 'fixtures.ts', 'support/fixtures.ts', 'tests/fixtures.ts'];

/** First candidate dir whose .ts files declare a page-object class; null if none. */
export function detectPomDir(scanned: { dir: string; contents: string[] }[]): string | null {
  for (const { dir, contents } of scanned) {
    if (contents.some((c) => /export\s+class\s+\w+/.test(c))) return dir;
  }
  return null;
}

/** First candidate fixtures file that exports `test`; null if none. */
export function detectFixturesFile(scanned: { path: string; content: string }[]): string | null {
  for (const { path, content } of scanned) {
    if (detectFixtureShape(content).exportsTest) return path;
  }
  return null;
}

export interface ApiClientInfo {
  fixtureName: string;
  className: string;
  methods: PomMethod[];
}

export interface AuthoringIdioms {
  pomConsumption: 'fixture-injection' | 'instantiation' | 'mixed' | 'unknown';
  pomCounts: { injected: number; instantiated: number };
  testImportPath: string | null;
  dataSources: string[];
  apiPattern: 'apiClient' | 'request' | 'mixed' | 'none';
  apiCounts: { apiClient: number; request: number };
  usesTags: boolean;
  usesSteps: boolean;
}

/** Pick the dominant of two counts: one wins if present and ≥3× the other; ties/close → 'mixed'. */
function dominant<A extends string, B extends string, M extends string>(
  a: number, aLabel: A, b: number, bLabel: B, mixed: M, none: M,
): A | B | M {
  if (a === 0 && b === 0) return none;
  if (b === 0 || a >= b * 3) return a >= b ? aLabel : bLabel;
  if (a === 0 || b >= a * 3) return b > a ? bLabel : aLabel;
  return mixed;
}

/**
 * Sample spec contents to infer how tests consume POMs, where data comes from, and
 * the API style. `path` is the spec's path so API-pattern detection can scope to
 * API specs without depending on the engine's config.
 */
export function detectAuthoringIdioms(specs: { path: string; content: string }[]): AuthoringIdioms {
  let injected = 0;
  let instantiated = 0;
  const importPaths = new Map<string, number>();
  const dataSources = new Set<string>();
  let apiClient = 0;
  let rawRequest = 0;
  let usesTags = false;
  let usesSteps = false;

  for (const { path, content } of specs) {
    // \w+[Pp]age requires a prefix so the bare `page` fixture doesn't count as POM injection.
    if (/async\s*\(\s*\{[^}]*\b\w+[Pp]age\b[^}]*\}/.test(content)) injected++;
    if (/\bnew\s+\w*Page\s*\(/.test(content)) instantiated++;

    const imp = content.match(/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/);
    if (imp) importPaths.set(imp[1], (importPaths.get(imp[1]) ?? 0) + 1);

    for (const m of content.matchAll(/from\s*['"]([^'"]*(?:data|testdata|constants|fixtures\/data)[^'"]*)['"]/gi)) {
      if (!/\/fixtures(\/index)?['"]?$/.test(m[1]) && !m[1].endsWith('/fixtures')) dataSources.add(m[1]);
    }

    if (/(^|\/)api(\/|\.)|\.api\.spec\.ts$/i.test(path)) {
      if (/\bapiClient\b|\bnew\s+ApiClient\b|ApiClient/.test(content)) apiClient++;
      if (/\brequest\.(get|post|put|delete|patch|fetch)\b|\{\s*request\s*\}/.test(content)) rawRequest++;
    }
    if (/@(smoke|regression|critical|high|medium|low|negative|boundary)\b/.test(content)) usesTags = true;
    if (/\btest\.step\s*\(/.test(content)) usesSteps = true;
  }

  const pomConsumption = dominant(injected, 'fixture-injection', instantiated, 'instantiation', 'mixed', 'unknown') as AuthoringIdioms['pomConsumption'];
  const apiPattern = dominant(apiClient, 'apiClient', rawRequest, 'request', 'mixed', 'none') as AuthoringIdioms['apiPattern'];

  const testImportPath = [...importPaths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    pomConsumption,
    pomCounts: { injected, instantiated },
    testImportPath,
    dataSources: [...dataSources],
    apiPattern,
    apiCounts: { apiClient, request: rawRequest },
    usesTags,
    usesSteps,
  };
}

export interface RunnerConfig {
  projects: string[];
  hasChromium: boolean;
  hasFirefox: boolean;
  hasWebkit: boolean;
  hasVisual: boolean;
  setupStyle: 'globalSetup' | 'setup-project' | 'none';
  storageState: string | null;
}

/** Strip `/* *​/` blocks and full-line `//` comments so commented-out config isn't parsed as active. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** Parse playwright.config.ts for project names, browser/visual availability, and the setup style. */
export function detectRunnerConfig(rawContent: string): RunnerConfig {
  const content = stripComments(rawContent);
  const projects = [...content.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const has = (re: RegExp) => projects.some((p) => re.test(p));
  const storage = content.match(/storageState:\s*['"]([^'"]+)['"]/);
  const setupStyle: RunnerConfig['setupStyle'] =
    /globalSetup\s*:/.test(content) ? 'globalSetup'
    : projects.includes('setup') ? 'setup-project'
    : 'none';
  return {
    projects,
    hasChromium: has(/chromium|chrome/i),
    hasFirefox: has(/firefox/i),
    hasWebkit: has(/webkit|safari/i),
    hasVisual: has(/visual/i),
    setupStyle,
    storageState: storage ? storage[1] : null,
  };
}

export interface PomApplyResult {
  changed: boolean;
  newPom: PomConfig;
  summary: string[];
  /** The full config with `pom` merged, pretty-printed — ready to write. */
  newConfigJson: string;
}

function diffPom(prev: Partial<PomConfig> | undefined, next: PomConfig): string[] {
  const out: string[] = [];
  if (prev?.baseClass !== next.baseClass) out.push(`baseClass: ${prev?.baseClass ?? '(unset)'} → ${next.baseClass}`);
  if (prev?.siteClass !== next.siteClass) out.push(`siteClass: ${prev?.siteClass ?? '(unset)'} → ${next.siteClass}`);
  const prevInter = new Set((prev?.intermediateClasses ?? []).map((c) => c.name));
  const nextInter = new Set(next.intermediateClasses.map((c) => c.name));
  const added = [...nextInter].filter((n) => !prevInter.has(n));
  const removed = [...prevInter].filter((n) => !nextInter.has(n));
  if (added.length) out.push(`intermediate classes added: ${added.join(', ')}`);
  if (removed.length) out.push(`intermediate classes removed: ${removed.join(', ')}`);
  const prevProvides = (prev?.siteClassProvides ?? []).length;
  if (prevProvides !== next.siteClassProvides.length) out.push(`siteClassProvides: ${prevProvides} → ${next.siteClassProvides.length} entries`);
  return out;
}

/** Merge a detected hierarchy into a parsed config object. Pure — does no I/O. */
export function computePomApply(currentConfig: Record<string, unknown>, hierarchy: PomHierarchy): PomApplyResult {
  const existing = currentConfig.pom as Partial<PomConfig> | undefined;
  const newPom = buildPomConfig(hierarchy, existing);
  const summary = diffPom(existing, newPom);
  const next = { ...currentConfig, pom: newPom };
  return { changed: summary.length > 0, newPom, summary, newConfigJson: JSON.stringify(next, null, 2) + '\n' };
}

/** The project's primary UI-test project name, for run_tests's default --project. */
export function primaryProject(runner: RunnerConfig | null): string | null {
  if (!runner || runner.projects.length === 0) return null;
  const skip = new Set(['setup', 'api', 'visual']);
  return runner.projects.find((p) => /^chromium$/i.test(p))
    ?? runner.projects.find((p) => /chrom/i.test(p))
    ?? runner.projects.find((p) => !skip.has(p.toLowerCase()))
    ?? runner.projects[0];
}

export interface DetectedConventions {
  hierarchy: PomHierarchy | null;
  fixtures: FixtureShape | null;
  idioms: AuthoringIdioms;
  runner: RunnerConfig | null;
  /** The API-client abstraction behind the apiClient fixture + its methods, if the project uses one. */
  apiClient: ApiClientInfo | null;
  /** Detected project-root-relative POM directory (e.g. "pages" or "src/pages"). */
  pomDir: string;
  /** Detected project-root-relative fixtures module (e.g. "fixtures/index.ts" or "support/fixtures.ts"). */
  fixturesPath: string;
}

/** Render the detected conventions as a human-readable markdown report. */
export function renderConventionsReport(d: DetectedConventions): string {
  const lines: string[] = ['# Project Conventions (detected)', '',
    '_Generated by `learn_conventions`. Review, then apply to `mcp-qa.config.json` so generation matches this project\'s style._', ''];

  lines.push('## Layout', '',
    `- POM directory: \`${d.pomDir}\`${d.pomDir !== 'pages' ? ' (non-standard — written to `pom.dir`)' : ''}`,
    `- Fixtures module: \`${d.fixturesPath}\`${d.fixturesPath !== 'fixtures/index.ts' ? ' (non-standard — written to `testing.fixtures`)' : ''}`,
    '');

  lines.push('## POM hierarchy', '');
  if (!d.hierarchy) {
    lines.push(`_No page objects found under \`${d.pomDir}/\`._`, '');
  } else {
    const h = d.hierarchy;
    lines.push(`- **base class:** \`${h.baseClass}\``);
    lines.push(`- **site class (owns nav/footer):** \`${h.siteClass}\`${h.collapsed ? '  ⚠️ collapsed — nav lives on the base class itself (no separate SitePage)' : ''}`);
    if (h.intermediateClasses.length) {
      lines.push('- **intermediate classes:**');
      for (const ic of h.intermediateClasses) lines.push(`  - \`${ic.name}\` (import \`${ic.importFrom}\`${ic.extendsClass ? `, extends ${ic.extendsClass}` : ''}, provides ${ic.provides.length})`);
    }
    if (h.components.length) lines.push(`- **components (composition):** ${h.components.map((c) => `\`${c}\``).join(', ')}`);
    lines.push(`- **leaf pages:** ${h.leafPages.length}`);
    if (h.siteClassProvides.length) lines.push(`- **site class provides (do-not-redeclare):** ${h.siteClassProvides.slice(0, 20).map((p) => `\`${p}\``).join(', ')}${h.siteClassProvides.length > 20 ? ' …' : ''}`);
    lines.push('');
  }

  lines.push('## Fixtures', '');
  if (!d.fixtures) {
    lines.push('_No `fixtures/index.ts` found._', '');
  } else {
    const f = d.fixtures;
    lines.push(`- exports \`test\`: ${yn(f.exportsTest)} · exports \`expect\`: ${yn(f.exportsExpect)}`);
    lines.push(`- base extension: ${f.baseExtension ? `\`${f.baseExtension}\`` : '_(plain @playwright/test)_'}`);
    lines.push(`- \`trackCleanup\` present: ${yn(f.hasTrackCleanup)}${f.hasTrackCleanup ? '' : '  ← generation must NOT assume it'}`);
    if (f.injectedFixtures.length) {
      lines.push(`- injected fixtures (${f.injectedFixtures.length}): ${f.injectedFixtures.slice(0, 24).map((x) => `\`${x.name}\``).join(', ')}${f.injectedFixtures.length > 24 ? ' …' : ''}`);
    }
    lines.push('');
  }

  lines.push('## Authoring idioms', '');
  const i = d.idioms;
  lines.push(`- **POM consumption:** ${i.pomConsumption} _(fixture-injection: ${i.pomCounts.injected} specs, instantiation: ${i.pomCounts.instantiated})_${i.pomConsumption === 'fixture-injection' ? '  ← inject page objects via fixtures; do NOT `new`' : ''}`);
  lines.push(`- test import path: ${i.testImportPath ? `\`${i.testImportPath}\`` : '_unknown_'}`);
  lines.push(`- data source(s): ${i.dataSources.length ? i.dataSources.map((s) => `\`${s}\``).join(', ') : '_none detected (inline data)_'}`);
  lines.push(`- API pattern: ${i.apiPattern} _(apiClient: ${i.apiCounts.apiClient}, raw request: ${i.apiCounts.request})_${i.apiPattern === 'apiClient' ? '  ← API tests use an ApiClient abstraction, not raw `request`' : ''}`);
  lines.push(`- uses tags: ${yn(i.usesTags)} · uses test.step: ${yn(i.usesSteps)}`, '');

  lines.push('## Runner', '');
  if (!d.runner) {
    lines.push('_No `playwright.config.ts` found._', '');
  } else {
    const r = d.runner;
    lines.push(`- projects: ${r.projects.length ? r.projects.map((p) => `\`${p}\``).join(', ') : '_none_'}`);
    lines.push(`- browsers: chromium ${yn(r.hasChromium)} · firefox ${yn(r.hasFirefox)} · webkit ${yn(r.hasWebkit)} · visual ${yn(r.hasVisual)}`);
    lines.push(`- setup style: ${r.setupStyle}${r.storageState ? ` · storageState \`${r.storageState}\`` : ''}`, '');
  }

  return lines.join('\n') + '\n';
}

function yn(b: boolean): string { return b ? '✅' : '❌'; }

/**
 * Render the detected conventions as a concise, imperative block for injection into the
 * generation system prompt. Deterministic (no LLM) — only emits lines that actually apply,
 * so a project that doesn't use, say, an ApiClient gets no API-pattern instruction.
 */
export function renderConventionsBlock(d: DetectedConventions): string {
  const out: string[] = ['This project already follows the conventions below — match them exactly:', ''];
  const h = d.hierarchy;

  if (h) {
    if (h.collapsed) {
      out.push(`- Page helpers extend \`${h.baseClass}\`, which itself owns the site nav/footer — there is NO separate site class. New page helpers extend \`${h.baseClass}\` (or an intermediate below), never a "SitePage".`);
    } else {
      out.push(`- Page-helper hierarchy: \`${h.baseClass}\` (base) → \`${h.siteClass}\` (owns site nav/footer). Full pages extend \`${h.siteClass}\`.`);
    }
    if (h.intermediateClasses.length) {
      out.push(`- Intermediate page classes (extend the right one when applicable): ${h.intermediateClasses.map((c) => `\`${c.name}\` (${c.importFrom})`).join(', ')}.`);
    }
    if (h.components.length) {
      out.push(`- Reusable UI components live in ${d.pomDir}/components/ (${h.components.map((c) => `\`${c}\``).join(', ')}) — compose these rather than re-implementing their locators.`);
    }
  }

  if (d.idioms.pomConsumption === 'fixture-injection' || d.idioms.pomConsumption === 'mixed') {
    out.push('- Consume page helpers via injected fixtures destructured from the test callback (e.g. `async ({ homePage }) => …`) — do NOT instantiate them with `new`.');
  }
  if (d.fixtures?.injectedFixtures.length) {
    const map = d.fixtures.injectedFixtures.slice(0, 24).map((f) => `\`${f.name}\` (${f.type})`).join(', ');
    out.push(`- Use these existing fixtures for their classes — destructure from the test callback, do NOT \`new\` the class: ${map}${d.fixtures.injectedFixtures.length > 24 ? ' …' : ''}.`);
  }
  if (d.idioms.testImportPath) {
    out.push(`- Import \`test\`/\`expect\` from \`${d.idioms.testImportPath}\`.`);
  }
  if (d.idioms.dataSources.length) {
    out.push(`- Test data lives in ${d.idioms.dataSources.map((s) => `\`${s}\``).join(', ')} — import from there, do NOT import from \`test-data/constants\` or inline literals.`);
  }
  if (d.idioms.apiPattern === 'apiClient' || d.idioms.apiPattern === 'mixed') {
    out.push('- API tests use the project\'s `apiClient` fixture (an ApiClient abstraction), not the raw Playwright `request` fixture.');
  }
  if (d.apiClient) {
    const sigs = d.apiClient.methods.slice(0, 30).map((m) => `\`${m.name}(${m.params})\``).join(', ');
    out.push(`- The \`${d.apiClient.fixtureName}\` fixture (${d.apiClient.className}) exposes these methods — call them directly, do NOT invent generic ones like \`.post()\`: ${sigs}.`);
  }
  if (d.fixtures && !d.fixtures.hasTrackCleanup) {
    out.push('- This project has NO `trackCleanup` fixture — do NOT reference or add one; handle any teardown the way the existing specs do.');
  }

  return out.join('\n') + '\n';
}

// ── I/O wrapper (the MCP tool) ──────────────────────────────────────────────────

async function readDirTs(dir: string): Promise<{ name: string; content: string }[]> {
  const out: { name: string; content: string }[] = [];
  try {
    const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.ts')) {
        out.push({ name: `${dir}/${e.name}`, content: await readFile(join(ROOT, dir, e.name), 'utf-8') });
      }
    }
  } catch { /* dir absent */ }
  return out;
}

/** Recursively collect *.spec.ts under a root dir (default "tests"), config-independent. */
async function readSpecs(rootDir: string): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  async function walk(rel: string): Promise<void> {
    let entries;
    try { entries = await readdir(join(ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(child);
      else if (e.name.endsWith('.spec.ts')) out.push({ path: child, content: await readFile(join(ROOT, child), 'utf-8') });
    }
  }
  await walk(rootDir);
  return out;
}

/** Gather the project's files and run every detector. Exported for the report + later phases. */
export async function gatherConventions(): Promise<DetectedConventions> {
  // Locate the POM directory and fixtures module — supports non-standard layouts
  // (src/pages/, support/fixtures.ts). Falls back to the defaults when nothing matches.
  const scannedDirs = await Promise.all(
    POM_DIR_CANDIDATES.map(async (dir) => ({ dir, files: await readDirTs(dir) })),
  );
  const pomDir = detectPomDir(scannedDirs.map((s) => ({ dir: s.dir, contents: s.files.map((f) => f.content) }))) ?? 'pages';
  const pages = scannedDirs.find((s) => s.dir === pomDir)?.files ?? [];

  const componentFiles = await readDirTs(`${pomDir}/components`);
  const componentClassNames = componentFiles
    .map((f) => f.content.match(/export\s+class\s+(\w+)/)?.[1])
    .filter((x): x is string => !!x);

  const scannedFixtures: { path: string; content: string }[] = [];
  for (const cand of FIXTURES_CANDIDATES) {
    try { scannedFixtures.push({ path: cand, content: await readFile(join(ROOT, cand), 'utf-8') }); } catch { /* absent */ }
  }
  const fixturesPath = detectFixturesFile(scannedFixtures) ?? 'fixtures/index.ts';
  const fixturesContent = scannedFixtures.find((s) => s.path === fixturesPath)?.content ?? '';
  const fixtures: FixtureShape | null = fixturesContent ? detectFixtureShape(fixturesContent) : null;

  // Resolve the API-client class (e.g. apiClient: ApiClient) and extract its methods, so
  // generation calls the real methods (verifyLogin(...)) instead of inventing apiClient.post().
  let apiClient: ApiClientInfo | null = null;
  const apiFixture = findApiClientFixture(fixtures);
  if (apiFixture) {
    const rel = resolveClassImport(fixturesContent, apiFixture.type, dirname(fixturesPath));
    if (rel) {
      try {
        const methods = extractPomMethods(await readFile(join(ROOT, rel), 'utf-8'));
        if (methods.length) apiClient = { fixtureName: apiFixture.name, className: apiFixture.type, methods };
      } catch { /* class file not found */ }
    }
  }

  let runnerSrc = '';
  try { runnerSrc = await readFile(join(ROOT, 'playwright.config.ts'), 'utf-8'); } catch { /* none */ }
  const runner = runnerSrc ? detectRunnerConfig(runnerSrc) : null;

  // Scan the project's test root (from playwright.config testDir, default "tests").
  const testDir = runnerSrc.match(/testDir:\s*['"]\.?\/?([^'"]+)['"]/)?.[1]?.replace(/^\/+/, '') || 'tests';
  const specs = await readSpecs(testDir);

  return {
    hierarchy: detectPomHierarchy(pages, componentClassNames),
    fixtures,
    idioms: detectAuthoringIdioms(specs),
    runner,
    apiClient,
    pomDir,
    fixturesPath,
  };
}

export async function learnConventionsTool(
  args: { output?: string; applyPom?: boolean; applyConventions?: boolean; write?: boolean } = {},
): Promise<{ content: { type: 'text'; text: string }[] }> {
  await ensureWorkspace();
  const detected = await gatherConventions();
  const report = renderConventionsReport(detected);
  const outputPath = args.output ?? WORKSPACE_PATHS.projectConventions;

  const result = await safeWrite(outputPath, report, { allowOverwrite: true });
  if (!result.ok) return errorContent(`Failed to write ${outputPath}: ${result.reason}`, { category: 'unknown', tool: 'learn_conventions' });

  const h = detected.hierarchy;
  const lines = [
    `✅ Wrote ${outputPath}`,
    '',
    h ? `POM: base \`${h.baseClass}\`, site \`${h.siteClass}\`${h.collapsed ? ' (collapsed)' : ''}, ${h.intermediateClasses.length} intermediate, ${h.leafPages.length} leaf pages${h.components.length ? `, ${h.components.length} components` : ''}` : 'POM: none found',
    `Fixtures: ${detected.fixtures ? `${detected.fixtures.injectedFixtures.length} injected, trackCleanup ${detected.fixtures.hasTrackCleanup ? 'present' : 'absent'}` : 'none'}`,
    `Idioms: POM consumption ${detected.idioms.pomConsumption}, API pattern ${detected.idioms.apiPattern}`,
    detected.runner ? `Runner: projects ${detected.runner.projects.join(', ') || '(none)'}` : 'Runner: no config',
  ];

  if (args.applyPom || args.applyConventions) {
    lines.push('', ...(await applySection(detected, { pom: !!args.applyPom, conventions: !!args.applyConventions, write: !!args.write })));
  } else {
    lines.push('', 'Review the report. Run with --apply-pom and/or --apply-conventions to write into mcp-qa.config.json.');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

/**
 * Apply (or dry-run) the detected hierarchy and/or conventions block into
 * mcp-qa.config.json. Returns summary lines. Both pieces merge into one config write.
 */
async function applySection(
  detected: DetectedConventions,
  opts: { pom: boolean; conventions: boolean; write: boolean },
): Promise<string[]> {
  const configPath = join(ROOT, 'mcp-qa.config.json');
  let raw: string;
  try { raw = await readFile(configPath, 'utf-8'); }
  catch { return ['⚠️  --apply: mcp-qa.config.json not found — run qa-init first, then apply.']; }

  let merged: Record<string, unknown>;
  try { merged = JSON.parse(raw); }
  catch (err) { return [`⚠️  --apply: could not parse mcp-qa.config.json: ${(err as Error).message}`]; }

  const diff: string[] = [];

  if (opts.pom) {
    if (!detected.hierarchy) {
      diff.push(`pom: no page objects found under ${detected.pomDir}/ — skipped.`);
    } else {
      const apply = computePomApply(merged, detected.hierarchy);
      merged = JSON.parse(apply.newConfigJson);
      diff.push(...(apply.changed ? apply.summary.map((s) => `pom — ${s}`) : ['pom — already matches the detected hierarchy.']));
    }
    // Set the runner project so run_tests targets the project's own primary project.
    const primary = primaryProject(detected.runner);
    const testing = merged.testing as { runnerProject?: string } | undefined;
    if (primary && testing && testing.runnerProject !== primary) {
      diff.push(`testing.runnerProject — ${testing.runnerProject ?? '(unset)'} → ${primary}`);
      merged = { ...merged, testing: { ...testing, runnerProject: primary } };
    }

    // Set the detected POM directory + fixtures module so the whole engine reads the
    // project's real layout (only when they differ from the defaults).
    const pom = merged.pom as { dir?: string } | undefined;
    if (pom && detected.pomDir !== 'pages' && pom.dir !== detected.pomDir) {
      diff.push(`pom.dir — ${pom.dir ?? '(default pages)'} → ${detected.pomDir}`);
      merged = { ...merged, pom: { ...pom, dir: detected.pomDir } };
    }
    const testing2 = merged.testing as { fixtures?: string } | undefined;
    if (testing2 && detected.fixturesPath !== 'fixtures/index.ts' && testing2.fixtures !== detected.fixturesPath) {
      diff.push(`testing.fixtures — ${testing2.fixtures ?? '(default fixtures/index.ts)'} → ${detected.fixturesPath}`);
      merged = { ...merged, testing: { ...testing2, fixtures: detected.fixturesPath } };
    }
  }

  if (opts.conventions) {
    const block = renderConventionsBlock(detected);
    const prev = (merged.prompts as { conventions?: string } | undefined)?.conventions;
    merged = { ...merged, prompts: { ...(merged.prompts as object ?? {}), conventions: block } };
    diff.push(prev === block ? 'prompts.conventions — already up to date.' : `prompts.conventions — ${prev ? 'updated' : 'set'} (${block.trimEnd().split('\n').length} lines).`);
  }

  try { validate(merged as unknown as Parameters<typeof validate>[0]); }
  catch (err) { return [`⚠️  --apply: the merged config is invalid, not writing: ${(err as Error).message}`]; }

  const header = opts.write ? '✅ Applied to mcp-qa.config.json:' : '👀 Dry run — proposed changes (not written):';
  const out = [header, ...diff.map((s) => `  - ${s}`)];

  if (opts.write) {
    const w = await safeWrite(configPath, JSON.stringify(merged, null, 2) + '\n', { allowOverwrite: true });
    if (!w.ok) return [`⚠️  --apply: failed to write mcp-qa.config.json: ${w.reason}`];
  } else {
    out.push('', 'Re-run with `--write` to apply these changes.');
  }
  return out;
}
