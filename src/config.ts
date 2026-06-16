import { readFileSync } from 'fs';
import { basename, join } from 'path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IntermediateClass {
  name: string;
  importFrom: string;
  description: string;
  paths: string[];
  provides: string[];
}

/**
 * Optional, site-specific configuration for `audit_site --mode data` — the
 * selectors/paths it scrapes to seed test-data/constants.ts. Absent for sites
 * whose catalogue layout the tool can't know; when absent, data mode skips
 * scraping and emits only the generic fixtures.
 */
export interface AuditConfig {
  /** Product listing page path, e.g. "/products". */
  productsPath: string;
  /** Login/registration page path, e.g. "/login". */
  loginPath: string;
  selectors: {
    /** A single product card. */
    productCard: string;
    /** Ancestor of the card holding the product-details link. */
    productWrapper: string;
    /** The product-details anchor within the wrapper. */
    productLink: string;
    /** Regex (as a string) extracting the numeric id from the link href. */
    productIdRegex: string;
    /** Product name element within the card. */
    productName: string;
    /** Product price element within the card. */
    productPrice: string;
    /** Category accordion panel. */
    categoryPanel: string;
    /** Category title link within a panel. */
    categoryTitle: string;
    /** Subcategory links within a panel. */
    categorySub: string;
    /** Search input — its presence means search exists. */
    search: string;
    /** Registration/login form inputs. */
    registrationInputs: string;
  };
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
  /** Optional config for `audit_site --mode data` catalogue scraping. */
  audit?: AuditConfig;
  /** Optional project-specific prompt enrichments injected into generation prompts. */
  prompts?: {
    /** Site-specific API quirks (response shapes, tricky fields) injected into the API test prompt. */
    apiNotes?: string;
    /** Site-specific API response contract (e.g. HTTP status vs in-body result code) for the API test prompt. */
    apiResponseFormat?: string;
    /** Site-specific pattern for tests needing valid credentials (account create/delete, required fields). */
    apiAuthPattern?: string;
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
        'mcp-qa.config.json not found in the project root. Run init_project ' +
        '(npm run init_project -- --name <name> --url <site-url>) to scaffold one ' +
        'before running any tools.'
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
    // pom and models are used unconditionally at runtime (buildPomHierarchyDescription,
    // config.models.primary) — validate them here so a malformed config fails fast
    // with a clear message instead of an opaque crash deep in a tool.
    ['pom.baseClass',            cfg.pom?.baseClass],
    ['pom.siteClass',            cfg.pom?.siteClass],
    ['models.primary',           cfg.models?.primary],
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
