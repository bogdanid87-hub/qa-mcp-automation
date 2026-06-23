import { readFileSync } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { validate, type MqaConfig } from './config-schema.js';

// Re-export the schema + validator so existing `from '../config.js'` imports keep
// working. The definitions live in config-schema.ts (which does NOT load the
// config singleton) so bootstrap paths like init_project can import them safely.
export { validate } from './config-schema.js';
export type { IntermediateClass, AuditConfig, MqaConfig } from './config-schema.js';

// ── Loader ─────────────────────────────────────────────────────────────────────

function loadConfig(): MqaConfig {
  const configPath = join(process.cwd(), 'mcp-qa.config.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as MqaConfig;
    validate(parsed);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'mcp-qa.config.json not found in the project root. Run init_project ' +
        '(npm run init_project -- --name <name> --url <site-url>) to scaffold one ' +
        'before running any tools.'
      );
    }
    throw err;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const config: MqaConfig = loadConfig();

// ── Derived constants ─────────────────────────────────────────────────────────

const ROOT = process.cwd();

export const TESTS_UI_PATH     = join(ROOT, config.testing.registries.ui);
export const TESTS_API_PATH    = join(ROOT, config.testing.registries.api);
export const TESTS_E2E_PATH    = join(ROOT, config.testing.registries.e2e);
export const TESTS_VISUAL_PATH = join(ROOT, config.testing.registries.visual);

export const SITE_URL = config.project.siteUrl;
export const SITE_HOST = new URL(SITE_URL).hostname;

/** Project-root-relative directory holding the page objects (default "pages"). */
export function pomDir(): string {
  return config.pom.dir ?? 'pages';
}

/** Project-root-relative path to the fixtures module (default "fixtures/index.ts"). */
export function fixturesFile(): string {
  return config.testing.fixtures ?? 'fixtures/index.ts';
}

/**
 * The module specifier importing `toFile` from a spec at `fromSpec` — resolved relative
 * to the spec's directory, with a trailing `/index` and the `.ts` extension dropped
 * (e.g. tests/ui/x.spec.ts → fixtures/index.ts ⇒ "../../fixtures"). Pure/testable.
 */
export function relativeImport(fromSpec: string, toFile: string): string {
  const posix = relative(dirname(fromSpec), toFile).split(sep).join('/')
    .replace(/\.ts$/, '')
    .replace(/\/index$/, '');
  return posix.startsWith('.') ? posix : `./${posix}`;
}

/** The module specifier a spec at `specPath` uses to import the project's fixtures module. */
export function fixturesImportSpecifier(specPath: string): string {
  return relativeImport(specPath, fixturesFile());
}

/** Returns the correct registry file for a given spec path. */
export function registryForSpec(specPath: string): string {
  const { folders } = config.testing;
  if (specPath.startsWith(`${folders.api}/`))    return TESTS_API_PATH;
  if (specPath.startsWith(`${folders.e2e}/`))    return TESTS_E2E_PATH;
  if (specPath.startsWith(`${folders.visual}/`)) return TESTS_VISUAL_PATH;
  return TESTS_UI_PATH;
}

/** Returns just the registry filename (e.g. "TESTS_UI.md") for a given spec path — for user-facing messages. */
export function registryNameForSpec(specPath: string): string {
  return basename(registryForSpec(specPath));
}

/** Classify a spec path by its configured test folder (ui / api / e2e / visual). */
export function specKind(specPath: string): 'ui' | 'api' | 'e2e' | 'visual' {
  const { folders } = config.testing;
  if (specPath.startsWith(`${folders.api}/`))    return 'api';
  if (specPath.startsWith(`${folders.e2e}/`))    return 'e2e';
  if (specPath.startsWith(`${folders.visual}/`)) return 'visual';
  return 'ui';
}

// riskTiers entries are regex-alternation fragments (e.g. "place.order" with `.`
// as any-char), preserved verbatim from the original hardcoded deriveRisk regexes.
const CRITICAL_RE = new RegExp(config.riskTiers.critical.join('|'));
const HIGH_RE     = new RegExp(config.riskTiers.high.join('|'));
const MEDIUM_RE   = new RegExp(config.riskTiers.medium.join('|'));

/** Infer risk level from spec path and describe block name. */
export function deriveRisk(spec: string, describe: string): 'critical' | 'high' | 'medium' | 'low' {
  const text = `${spec} ${describe}`.toLowerCase();
  if (CRITICAL_RE.test(text)) return 'critical';
  if (HIGH_RE.test(text))     return 'high';
  if (MEDIUM_RE.test(text))   return 'medium';
  return 'low';
}

/**
 * Build the POM hierarchy description for the system prompt, generated from
 * config.pom so the class list, import paths, and "do NOT re-declare" provides
 * lists stay in sync with the actual page-object hierarchy.
 */
export function buildPomHierarchyDescription(): string {
  const { pom } = config;
  const intermediateClasses = pom.intermediateClasses ?? [];
  const siteClassProvides = pom.siteClassProvides ?? [];
  const allNames = [pom.siteClass, ...intermediateClasses.map((c) => c.name), pom.baseClass];
  const nameWidth = Math.max(...allNames.map((n) => n.length)) + 1;

  const lines: string[] = [
    'POM hierarchy — choose the right parent class:',
    '',
    `  ${pom.siteClass.padEnd(nameWidth)}(import from './${pom.siteClass}') — any full site page (has nav bar, footer, loggedInAs)`,
  ];
  for (const ic of intermediateClasses) {
    lines.push(`  ${ic.name.padEnd(nameWidth)}(import from '${ic.importFrom}') — ${ic.description}: ${ic.paths.join(', ')}`);
  }
  lines.push(`  ${pom.baseClass.padEnd(nameWidth)}(import from './${pom.baseClass}') — only for pages with no site nav/footer`);

  if (siteClassProvides.length > 0) {
    lines.push(
      '',
      `${pom.siteClass} already provides (do NOT re-declare in subclasses):`,
      `  ${siteClassProvides.join(', ')}`,
    );
  }

  for (const ic of intermediateClasses) {
    if (ic.provides.length === 0) continue;
    lines.push(
      '',
      `${ic.name} additionally provides (do NOT re-declare in subclasses):`,
      `  ${ic.provides.join(', ')}`,
    );
  }

  return lines.join('\n');
}
