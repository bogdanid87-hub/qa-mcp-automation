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
import { join } from 'path';
import { safeWrite } from '../lib/safe-write.js';
import { validate } from '../config-schema.js';
import { WORKSPACE_PATHS, ensureWorkspace } from '../workspace.js';
import { errorContent } from '../lib/format-error.js';
import { buildPomIndex, extractPomLocators, type PomIndexEntry } from './pom-index.js';

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

export interface DetectedConventions {
  hierarchy: PomHierarchy | null;
  fixtures: FixtureShape | null;
  idioms: AuthoringIdioms;
  runner: RunnerConfig | null;
}

/** Render the detected conventions as a human-readable markdown report. */
export function renderConventionsReport(d: DetectedConventions): string {
  const lines: string[] = ['# Project Conventions (detected)', '',
    '_Generated by `learn_conventions`. Review, then apply to `mcp-qa.config.json` (PR 2) so generation matches this project\'s style._', ''];

  lines.push('## POM hierarchy', '');
  if (!d.hierarchy) {
    lines.push('_No page objects found under `pages/`._', '');
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
  const pages = await readDirTs('pages');
  const componentFiles = await readDirTs('pages/components');
  const componentClassNames = componentFiles
    .map((f) => f.content.match(/export\s+class\s+(\w+)/)?.[1])
    .filter((x): x is string => !!x);

  let fixtures: FixtureShape | null = null;
  try { fixtures = detectFixtureShape(await readFile(join(ROOT, 'fixtures', 'index.ts'), 'utf-8')); } catch { /* none */ }

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
  };
}

export async function learnConventionsTool(
  args: { output?: string; applyPom?: boolean; write?: boolean } = {},
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

  if (args.applyPom) {
    lines.push('', ...(await applyPomSection(detected.hierarchy, !!args.write)));
  } else {
    lines.push('', 'Review the report. Run with --apply-pom to write the detected hierarchy into mcp-qa.config.json.');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

/** Apply (or dry-run) the detected POM hierarchy into mcp-qa.config.json. Returns summary lines. */
async function applyPomSection(hierarchy: PomHierarchy | null, write: boolean): Promise<string[]> {
  if (!hierarchy) return ['⚠️  --apply-pom: no page objects found under pages/ — nothing to apply.'];

  const configPath = join(ROOT, 'mcp-qa.config.json');
  let raw: string;
  try { raw = await readFile(configPath, 'utf-8'); }
  catch { return ['⚠️  --apply-pom: mcp-qa.config.json not found — run qa-init first, then --apply-pom.']; }

  let currentConfig: Record<string, unknown>;
  try { currentConfig = JSON.parse(raw); }
  catch (err) { return [`⚠️  --apply-pom: could not parse mcp-qa.config.json: ${(err as Error).message}`]; }

  const apply = computePomApply(currentConfig, hierarchy);
  try { validate(JSON.parse(apply.newConfigJson)); }
  catch (err) { return [`⚠️  --apply-pom: the merged config is invalid, not writing: ${(err as Error).message}`]; }

  if (!apply.changed) return ['✓ config.pom already matches the detected hierarchy — no change.'];

  const header = write ? '✅ Applied to mcp-qa.config.json — pom changes:' : '👀 Dry run — proposed pom changes (not written):';
  const out = [header, ...apply.summary.map((s) => `  - ${s}`)];

  if (write) {
    const w = await safeWrite(configPath, apply.newConfigJson, { allowOverwrite: true });
    if (!w.ok) return [`⚠️  --apply-pom: failed to write mcp-qa.config.json: ${w.reason}`];
  } else {
    out.push('', 'Re-run with `--apply-pom --write` to apply these changes.');
  }
  return out;
}
