import { z } from 'zod';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'generate_test',
    description:
      'Write an automated test for the web app being tested (configured in mcp-qa.config.json) ' +
      'from a plain-English description — the single most-used tool. It works out the kind of test ' +
      '(a single-page UI check, an API check with no browser, a multi-page journey, or a mix), ' +
      'writes the test file, runs it, fixes it if it fails on the first try, records the result, ' +
      'and builds any reusable page helpers (Page Objects) the test needs along the way.',
    inputSchema: {
      description: z.string().describe('What to test — plain text or numbered steps. For API tests describe the endpoint, method, and assertions. For UI tests describe the user flow.'),
      test_name: z.string().optional().describe('Names the test() and describe() blocks. Does not control the filename.'),
      spec_file: z.string().optional().describe('Target spec file, e.g. "tests/ui/cart.spec.ts", "tests/api/products.spec.ts", or "tests/e2e/checkout.spec.ts". Inferred if omitted. tests/api/ prefix forces API generation.'),
      req_id: z.string().optional().describe('REQ ID from REQUIREMENTS.md / prd-tests.txt\'s # req_id field — when set, the generated test is tagged @req:REQ-NNN for traceability'),
      page_paths: z.array(z.string()).optional().describe('Page paths to inspect live for accurate locators (UI/E2E tests). The server navigates each page headlessly and extracts real DOM elements.'),
      dry_run: z.boolean().optional().describe('When true: generate the test but do NOT write files or run it. Returns a preview showing the target spec path and proposed code. Call again without dry_run to write and run.'),
      type: z.enum(['auto', 'ui', 'e2e', 'api', 'visual']).optional().describe('Override auto-detection: "api" → request fixture, "visual" → screenshot comparison in tests/visual/, "ui"/"e2e" → browser. Omit to auto-detect.'),
    },
  },

  {
    name: 'analyze_coverage',
    description:
      'Review the tests that already exist and report what is missing or risky — untested flows, ' +
      'missing negative/edge cases — and how important each gap is. Writes a plain-English report ' +
      '(coverage-report.md) and can also write a ready-to-run list of the suggested tests. ' +
      'Focus it on one test file/folder, point it at a page or docs URL for extra context.',
    inputSchema: {
      spec_path: z.string().optional().describe('A test file or folder to focus on, e.g. "tests/ui/contact.spec.ts" or "tests/api/"'),
      registry_path: z.string().optional().describe('A test-catalog file to focus on (the registries that track recorded tests), e.g. "TESTS_UI.md"'),
      url: z.string().optional().describe('URL for feature context — site pages use DOM extraction, external docs use plain text'),
      generate_gaps: z.boolean().optional().describe('Also write coverage-gaps.txt in prd-tests.txt batch format (default: false)'),
      deep: z.boolean().optional().describe('Run a pre-analysis pass to identify untested paths before the main analysis — improves accuracy but costs an extra Claude call (default: false)'),
    },
  },

  {
    name: 'analyze_prd',
    description:
      'Turn a requirements doc or feature description into a prioritised to-do list of tests ' +
      '(most critical first). It skips anything already covered, so you get a genuine list of what is ' +
      'missing, and writes it to prd-tests.txt ready to feed straight into test generation ' +
      '(`npm run generate -- --file prd-tests.txt`) — no copy-pasting.',
    inputSchema: {
      prd_content: z.string().optional().describe('The PRD text to analyse. Paste the full document, a feature section, or a list of user stories. Required unless spec_path is provided.'),
      spec_path: z.string().optional().describe('Path to an existing .spec.ts file — extracts its test names and suggests what coverage is missing. Alternative to prd_content.'),
      output_file: z.string().optional().describe('Output file path. Defaults to prd-tests.txt in the project root.'),
      tier: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional().describe('Only generate tests at these risk levels, e.g. ["critical", "high"]. Omits all others.'),
      focus: z.array(z.string()).optional().describe('Only generate tests for these feature areas, e.g. ["checkout", "authentication"]. Omits all others.'),
    },
  },

  {
    name: 'generate_pom',
    description:
      'Prepare a reusable "page helper" (a Page Object) for one or more pages by looking at the live ' +
      'page and capturing the right way to find each element — so later test-writing does not have to ' +
      'guess. Usually optional: generate_test creates these automatically; use this only when you want ' +
      'to set a page up in advance. generate_test fills in the actions later.',
    inputSchema: {
      urls: z.array(z.string()).describe('Page paths to inspect and generate POMs for, e.g. ["/login", "/checkout"].'),
      page_name: z.string().optional().describe('Class name override when inspecting a single URL, e.g. "LoginPage". Inferred from the URL if omitted.'),
    },
  },

  {
    name: 'run_tests',
    description:
      'Run the existing tests and return the results. Target one file or folder, or run a single ' +
      'test by name — it purely runs them, with no fixing or file changes.',
    inputSchema: {
      pattern: z.string().optional().describe('File path, folder, or glob — e.g. "tests/ui/cart.spec.ts" or "tests/api/"'),
      grep: z.string().optional().describe('Filter by test name (Playwright --grep). Runs only tests whose name contains this string, e.g. "should add two products to cart"'),
      browser: z.enum(['chromium', 'firefox', 'webkit', 'visual']).optional().describe('Browser project to run (default: chromium). Use "visual" to run the visual regression project.'),
    },
  },

  {
    name: 'list_resources',
    description:
      'List the test files and reusable helpers (page objects, login/setup fixtures) that already ' +
      'exist in the project — handy to check before making new ones so you do not duplicate work.',
    inputSchema: {},
  },

  {
    name: 'investigate_and_fix',
    description:
      'Diagnose a failing test, fix the cause, and remember the lesson so the same mistake is not ' +
      'repeated in future tests. It tells apart a real bug in the app from a bug in the test. ' +
      'Paste the failure, or leave it empty to run the tests and find the failure first.',
    inputSchema: {
      test_output: z.string().optional().describe('Paste of failing playwright test output. If omitted, tests are run automatically.'),
      pattern: z.string().optional().describe('Test file pattern to run when test_output is not provided.'),
    },
  },

  {
    name: 'inspect_page',
    description:
      'Diagnostic: open one or more pages and list the elements found, with the best way to target ' +
      'each — useful for debugging why a test cannot find something on the page. You rarely need this ' +
      'directly; generate_test and generate_pom already do it for you.',
    inputSchema: {
      paths: z.array(z.string()).describe('Page paths to inspect, e.g. ["/contact_us", "/login"]'),
    },
  },

  {
    name: 'generate_auth_fixture',
    description:
      'Set up a reusable "logged-in" state for tests. Give it the login page URL and a name; ' +
      'it inspects the page to auto-detect the email/password/submit fields, then produces a ' +
      'global.setup.ts task that signs in and saves the browser session, plus a named fixture ' +
      '(e.g. loggedInPage) so tests start already authenticated. The field selectors are optional ' +
      '(only needed to override the auto-detection). Supports form login and OAuth redirect flows.',
    inputSchema: {
      type:             z.enum(['form', 'oauth']).default('form').describe('Auth flow type'),
      name:             z.string().describe('Fixture name, e.g. "loggedIn", "admin", "premiumUser"'),
      loginUrl:         z.string().describe('Login page path or full URL'),
      emailSelector:    z.string().optional().describe('Optional — selector for the email/username input. Auto-detected from the page if omitted.'),
      passwordSelector: z.string().optional().describe('Optional — selector for the password input. Auto-detected from the page if omitted.'),
      submitSelector:   z.string().optional().describe('Optional — selector for the submit button. Auto-detected from the page if omitted.'),
      successIndicator: z.string().optional().describe('URL pattern or selector confirming successful login'),
      usernameEnvVar:   z.string().optional().describe('Environment variable name for the username, e.g. TEST_EMAIL'),
      passwordEnvVar:   z.string().optional().describe('Environment variable name for the password, e.g. TEST_PASSWORD'),
      notes:            z.string().optional().describe('Extra context — e.g. "login form is inside an iframe", "MFA step shown after password"'),
    },
  },

  {
    name: 'generate_mock',
    description:
      'Fake a network response so a test does not depend on a real or third-party service ' +
      '(e.g. a payment API like Stripe), or to force an error/loading state and keep the data ' +
      'predictable. Outputs a reusable helper or an inline snippet.',
    inputSchema: {
      name:         z.string().describe('Mock name, e.g. "stripeSuccess", "productSearch", "apiError"'),
      urlPattern:   z.string().describe('URL pattern to intercept, e.g. "**/api/products" or "https://api.stripe.com/**"'),
      method:       z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', '*']).optional().describe('HTTP method to intercept (default: *)'),
      status:       z.number().optional().describe('HTTP status code to return (default: 200)'),
      responseBody: z.string().describe('Describe the response body in plain English or paste JSON'),
      scope:        z.enum(['fixture', 'inline']).optional().describe('"fixture" = shared file (default); "inline" = code snippet for one test'),
      notes:        z.string().optional().describe('Extra context, e.g. "simulates a Stripe card_declined error"'),
    },
  },

  {
    name: 'generate_app_knowledge',
    description:
      'Gather what has been learned about this app — known bugs, recurring gaps, risk patterns — ' +
      'into one reference file (APP_KNOWLEDGE.md). Once it exists, analyze_prd and analyze_coverage ' +
      'read it automatically, so their suggestions account for this specific app.',
    inputSchema: {
      output: z.string().optional().describe('Output file path (default: APP_KNOWLEDGE.md in project root)'),
    },
  },

  {
    name: 'learn_conventions',
    description:
      'Read this project\'s existing pages, fixtures, tests, and Playwright config to detect the ' +
      'conventions it already uses — the page-helper class hierarchy, how tests get their page ' +
      'helpers, where test data lives, the API-test style, and the runner setup — and write a ' +
      'PROJECT_CONVENTIONS.md report. Run this after dropping the engine into an existing project so ' +
      'later generation can match the house style instead of imposing defaults.',
    inputSchema: {
      output: z.string().optional().describe('Output file path (default: workspace/PROJECT_CONVENTIONS.md)'),
      apply_pom: z.boolean().optional().describe('Also apply the detected page-helper hierarchy to mcp-qa.config.json (previews the change unless write is also set)'),
      write: z.boolean().optional().describe('With apply_pom, actually write the config changes instead of just previewing them'),
    },
  },

  {
    name: 'plan_e2e',
    description:
      'Advanced: sketch a multi-page journey before writing it — break the flow into the page helpers ' +
      'and steps it needs, and flag any helper actions that already exist so they get reused instead ' +
      'of duplicated. Writes no files; one planning step. generate_test does this internally, so use ' +
      'this only to preview a complex flow first.',
    inputSchema: {
      description: z.string().describe('The end-to-end journey to plan, e.g. numbered steps across multiple pages.'),
      page_paths: z.array(z.string()).optional().describe('Page paths to inspect live for DOM context, improving plan accuracy.'),
    },
  },

  {
    name: 'init_project',
    description:
      'Set up a new project to test a given site: writes the config file (mcp-qa.config.json) and a ' +
      'ready-to-run starter scaffold (Playwright config, a page-helper skeleton, the test folders), ' +
      'then prints the next steps. No site crawl or AI calls — just files. Run this once when ' +
      'starting on a new site.',
    inputSchema: {
      project_name: z.string().describe('Name for the new project, e.g. "my-shop"'),
      site_url: z.string().describe('Base URL of the site to test, e.g. "https://example.com"'),
      profile: z.enum(['generic', 'ecommerce']).optional().describe('Risk-tier keyword profile (default: "generic"). "ecommerce" matches shop-like demo sites.'),
      output_path: z.string().optional().describe('Where to write mcp-qa.config.json (default: ./mcp-qa.config.json). Use a different path to scaffold without touching the current project.'),
      force: z.boolean().optional().describe('Overwrite an existing mcp-qa.config.json (default: false — refuses if one already exists). Scaffold files are always create-if-missing regardless of this flag.'),
      risk_tiers: z.object({
        critical: z.array(z.string()).optional(),
        high: z.array(z.string()).optional(),
        medium: z.array(z.string()).optional(),
        low: z.array(z.string()).optional(),
      }).optional().describe('Per-tier overrides applied on top of the chosen profile.'),
    },
  },

  {
    name: 'review_rules',
    description:
      'Maintenance: health-check the saved lessons (the "learned rules" the engine accumulates from ' +
      'fixing tests) — flag stale ones and near-duplicates. Pass `promote` to move a project-specific ' +
      'lesson into the engine-wide rule set so it applies to every project. Read-only unless you ' +
      'promote; it never auto-suggests what to promote — that is a human judgment call.',
    inputSchema: {
      promote: z.string().optional().describe(
        'Rule number in learned-rules.md to promote to framework-rules.md, e.g. "015". ' +
        'When set, performs the promotion and returns a confirmation instead of the hygiene report.',
      ),
    },
  },
];
