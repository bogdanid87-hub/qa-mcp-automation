/**
 * Pure schema + validation for mcp-qa.config.json.
 *
 * This module imports nothing that loads the config singleton, so bootstrap
 * paths — chiefly `init_project`, whose job is to CREATE the config — can import
 * the types and `validate()` without triggering `config.ts`'s eager load (which
 * throws in a fresh project that has no config yet).
 */

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

// ── Validation ─────────────────────────────────────────────────────────────────

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
