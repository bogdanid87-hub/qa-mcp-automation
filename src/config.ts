import { readFileSync } from 'fs';
import { join } from 'path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IntermediateClass {
  name: string;
  importFrom: string;
  description: string;
  paths: string[];
  provides: string[];
}

export interface MqaConfig {
  project: {
    name: string;
    siteUrl: string;
  };
  testing: {
    folders: {
      ui: string;
      api: string;
      e2e: string;
      visual: string;
    };
    registries: {
      ui: string;
      api: string;
      e2e: string;
      visual: string;
    };
  };
  riskTiers: {
    critical: string[];
    high: string[];
    medium: string[];
    low: string[];
  };
  pom: {
    baseClass: string;
    siteClass: string;
    siteClassProvides: string[]; // locators/methods siteClass owns — LLM told not to re-declare these
    intermediateClasses: IntermediateClass[];
  };
  models: {
    primary: string;
    local: string;
  };
}

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
        'mcp-qa.config.json not found in the project root. Copy mcp-qa.config.json from ' +
        'the skeleton and fill in your project details before running any tools.'
      );
    }
    throw err;
  }
}

export function validate(cfg: MqaConfig): void {
  const required: Array<[string, unknown]> = [
    ['project.name',             cfg.project?.name],
    ['project.siteUrl',          cfg.project?.siteUrl],
    ['testing.folders.ui',       cfg.testing?.folders?.ui],
    ['testing.folders.api',      cfg.testing?.folders?.api],
    ['testing.folders.e2e',      cfg.testing?.folders?.e2e],
    ['testing.folders.visual',   cfg.testing?.folders?.visual],
    ['testing.registries.ui',     cfg.testing?.registries?.ui],
    ['testing.registries.api',    cfg.testing?.registries?.api],
    ['testing.registries.e2e',    cfg.testing?.registries?.e2e],
    ['testing.registries.visual', cfg.testing?.registries?.visual],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`mcp-qa.config.json is missing required fields: ${missing.join(', ')}`);
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

/** Returns the correct registry file for a given spec path. */
export function registryForSpec(specPath: string): string {
  const { folders } = config.testing;
  if (specPath.startsWith(`${folders.api}/`))    return TESTS_API_PATH;
  if (specPath.startsWith(`${folders.e2e}/`))    return TESTS_E2E_PATH;
  if (specPath.startsWith(`${folders.visual}/`)) return TESTS_VISUAL_PATH;
  return TESTS_UI_PATH;
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
  const allNames = [pom.siteClass, ...pom.intermediateClasses.map((c) => c.name), pom.baseClass];
  const nameWidth = Math.max(...allNames.map((n) => n.length)) + 1;

  const lines: string[] = [
    'POM hierarchy — choose the right parent class:',
    '',
    `  ${pom.siteClass.padEnd(nameWidth)}(import from './${pom.siteClass}') — any full site page (has nav bar, footer, loggedInAs)`,
  ];
  for (const ic of pom.intermediateClasses) {
    lines.push(`  ${ic.name.padEnd(nameWidth)}(import from '${ic.importFrom}') — ${ic.description}: ${ic.paths.join(', ')}`);
  }
  lines.push(`  ${pom.baseClass.padEnd(nameWidth)}(import from './${pom.baseClass}') — only for pages with no site nav/footer`);

  if (pom.siteClassProvides.length > 0) {
    lines.push(
      '',
      `${pom.siteClass} already provides (do NOT re-declare in subclasses):`,
      `  ${pom.siteClassProvides.join(', ')}`,
    );
  }

  for (const ic of pom.intermediateClasses) {
    if (ic.provides.length === 0) continue;
    lines.push(
      '',
      `${ic.name} additionally provides (do NOT re-declare in subclasses):`,
      `  ${ic.provides.join(', ')}`,
    );
  }

  return lines.join('\n');
}
