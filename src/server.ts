import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { generateTestTool } from './tools/generate-test.js';
import { generatePomTool } from './tools/generate-pom.js';
import { analyzePrdTool } from './tools/analyze-prd.js';
import { analyzeCoverageTool } from './tools/analyze-coverage.js';
import { runTestsTool } from './tools/run-tests.js';
import { listResourcesTool } from './tools/list-resources.js';
import { investigateFixTool } from './tools/investigate-fix.js';
import { inspectPageTool } from './tools/inspect-page.js';
import { generateAuthFixtureTool } from './tools/generate-auth-fixture.js';
import { generateMockTool } from './tools/generate-mock.js';
import { generateAppKnowledgeTool } from './tools/generate-app-knowledge.js';
import { planE2eTool } from './tools/plan-e2e.js';
import { initProjectTool } from './tools/init-project.js';
import { reviewRulesTool } from './tools/review-rules.js';

/** Builds the MCP server with all 14 tools registered. Caller connects it to a transport. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'qa-mcp-automation', version: '1.0.0' });

  server.registerTool(
    'generate_test',
    {
      description:
        'Generate a Playwright test for automationexercise.com. ' +
        'Handles UI tests (browser + Page Object Model), API tests (request fixture, no browser), ' +
        'E2E flows (multi-page), and mixed tests (API setup + UI interaction). ' +
        'The type is detected automatically from the description and spec_file path — ' +
        'no need to call a separate API test tool. ' +
        'Writes the spec, runs it, attempts auto-fix on failure, and records the result.',
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
    (args) => generateTestTool(args as Parameters<typeof generateTestTool>[0]),
  );

  server.registerTool(
    'analyze_coverage',
    {
      description:
        'Analyse the existing test suite and identify coverage gaps and risk areas. ' +
        'Scope to a specific spec file, folder, or registry; optionally fetch a page or docs URL for context. ' +
        'Writes coverage-report.md (always) and optionally coverage-gaps.txt in the prd-tests.txt batch format. ' +
        'For URLs pointing to automationexercise.com, DOM inspection is used for richer element context.',
      inputSchema: {
        spec_path: z.string().optional().describe('Spec file or folder to focus on, e.g. "tests/ui/contact.spec.ts" or "tests/api/"'),
        registry_path: z.string().optional().describe('Registry file to focus on, e.g. "TESTS_UI.md"'),
        url: z.string().optional().describe('URL for feature context — site pages use DOM extraction, external docs use plain text'),
        generate_gaps: z.boolean().optional().describe('Also write coverage-gaps.txt in prd-tests.txt batch format (default: false)'),
        deep: z.boolean().optional().describe('Run a pre-analysis pass to identify untested paths before the main analysis — improves accuracy but costs an extra Claude call (default: false)'),
      },
    },
    (args) => analyzeCoverageTool({
      specPath: args.spec_path,
      registryPath: args.registry_path,
      url: args.url,
      generateGaps: args.generate_gaps,
      deep: args.deep,
    }),
  );

  server.registerTool(
    'analyze_prd',
    {
      description:
        'Analyse a PRD or feature description and generate a prioritised list of test case suggestions ' +
        'grouped by risk level (critical → high → medium → low). ' +
        'Filters out tests that already exist in the test registries so the output is a genuine gap list. ' +
        'Writes suggestions to prd-tests.txt in the same batch format as my-test.txt so you can run ' +
        '`npm run generate -- --file prd-tests.txt` directly without any copy-pasting.',
      inputSchema: {
        prd_content: z.string().optional().describe('The PRD text to analyse. Paste the full document, a feature section, or a list of user stories. Required unless spec_path is provided.'),
        spec_path: z.string().optional().describe('Path to an existing .spec.ts file — extracts its test names and suggests what coverage is missing. Alternative to prd_content.'),
        output_file: z.string().optional().describe('Output file path. Defaults to prd-tests.txt in the project root.'),
        tier: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional().describe('Only generate tests at these risk levels, e.g. ["critical", "high"]. Omits all others.'),
        focus: z.array(z.string()).optional().describe('Only generate tests for these feature areas, e.g. ["checkout", "authentication"]. Omits all others.'),
      },
    },
    (args) => analyzePrdTool({
      prdContent: args.prd_content,
      specPath: args.spec_path,
      outputFile: args.output_file,
      tier: args.tier,
      focus: args.focus,
    }),
  );

  server.registerTool(
    'generate_pom',
    {
      description:
        'Inspect one or more pages on automationexercise.com and generate locator-only Page Object Model files. ' +
        'Each file contains readonly Locator properties and constructor assignments — no methods. ' +
        'Use this before generate_test to pre-populate correct locators from the live DOM, eliminating ' +
        'locator guessing and the fix-loop iterations it causes. ' +
        'generate_test will add methods to these files when building tests.',
      inputSchema: {
        urls: z.array(z.string()).describe('Page paths to inspect and generate POMs for, e.g. ["/login", "/checkout"].'),
        page_name: z.string().optional().describe('Class name override when inspecting a single URL, e.g. "LoginPage". Inferred from the URL if omitted.'),
      },
    },
    (args) => generatePomTool(args),
  );

  server.registerTool(
    'run_tests',
    {
      description:
        'Run Playwright tests (Chromium) and return the output. ' +
        'Use pattern to target a file or folder; use grep to run a single test by name ' +
        'without triggering investigation or file changes.',
      inputSchema: {
        pattern: z.string().optional().describe('File path, folder, or glob — e.g. "tests/ui/cart.spec.ts" or "tests/api/"'),
        grep:    z.string().optional().describe('Filter by test name (Playwright --grep). Runs only tests whose name contains this string, e.g. "should add two products to cart"'),
        browser: z.enum(['chromium', 'firefox', 'webkit', 'visual']).optional().describe('Browser project to run (default: chromium). Use "visual" to run the visual regression project.'),
      },
    },
    (args) => runTestsTool(args),
  );

  server.registerTool(
    'list_resources',
    {
      description:
        'List existing page objects, fixtures, and test files in the project. ' +
        'Useful before calling generate_test to avoid duplicating existing code.',
      inputSchema: {},
    },
    () => listResourcesTool(),
  );

  server.registerTool(
    'investigate_and_fix',
    {
      description:
        'Investigate a Playwright test failure, fix the code, and add a learned rule to the system prompt ' +
        'so the same problem never occurs in generated tests again. ' +
        'Paste the failure output, or leave it empty to run the tests automatically first.',
      inputSchema: {
        test_output: z.string().optional().describe('Paste of failing playwright test output. If omitted, tests are run automatically.'),
        pattern: z.string().optional().describe('Test file pattern to run when test_output is not provided.'),
      },
    },
    (args) => investigateFixTool(args),
  );

  server.registerTool(
    'inspect_page',
    {
      description:
        'Navigate to one or more pages on automationexercise.com headlessly and extract real DOM elements ' +
        '(data-qa attributes, ids, placeholders, roles, text, form structure). ' +
        'Use the output to understand what locators are available before generating a POM, ' +
        'or pass the paths directly to generate_test via page_paths to do this automatically.',
      inputSchema: {
        paths: z.array(z.string()).describe('Page paths to inspect, e.g. ["/contact_us", "/login"]'),
      },
    },
    (args) => inspectPageTool(args),
  );

  server.registerTool(
    'generate_auth_fixture',
    {
      description:
        'Generate a Playwright auth fixture for a login flow — produces a global.setup.ts task that ' +
        'authenticates and saves browser storage state, plus a named fixture (e.g. loggedInPage) for ' +
        'use in tests. Supports form-based login and OAuth redirect flows.',
      inputSchema: {
        type:              z.enum(['form', 'oauth']).default('form').describe('Auth flow type'),
        name:              z.string().describe('Fixture name, e.g. "loggedIn", "admin", "premiumUser"'),
        loginUrl:          z.string().describe('Login page path or full URL'),
        emailSelector:     z.string().optional().describe('CSS/data-qa selector for the email or username input'),
        passwordSelector:  z.string().optional().describe('CSS/data-qa selector for the password input'),
        submitSelector:    z.string().optional().describe('CSS/data-qa selector for the submit button'),
        successIndicator:  z.string().optional().describe('URL pattern or selector confirming successful login'),
        usernameEnvVar:    z.string().optional().describe('Environment variable name for the username, e.g. TEST_EMAIL'),
        passwordEnvVar:    z.string().optional().describe('Environment variable name for the password, e.g. TEST_PASSWORD'),
        notes:             z.string().optional().describe('Extra context — e.g. "login form is inside an iframe", "MFA step shown after password"'),
      },
    },
    (args) => generateAuthFixtureTool(args as any),
  );

  server.registerTool(
    'generate_mock',
    {
      description:
        'Generate a Playwright page.route() network mock — intercepts a URL pattern and returns a ' +
        'controlled response. Use for mocking third-party APIs (Stripe, Twilio), testing error states, ' +
        'or making test data deterministic. Outputs a reusable fixture or an inline code snippet.',
      inputSchema: {
        name:         z.string().describe('Mock name, e.g. "stripeSuccess", "productSearch", "apiError"'),
        urlPattern:   z.string().describe('URL pattern to intercept, e.g. "**/api/products" or "https://api.stripe.com/**"'),
        method:       z.enum(['GET','POST','PUT','PATCH','DELETE','*']).optional().describe('HTTP method to intercept (default: *)'),
        status:       z.number().optional().describe('HTTP status code to return (default: 200)'),
        responseBody: z.string().describe('Describe the response body in plain English or paste JSON'),
        scope:        z.enum(['fixture','inline']).optional().describe('"fixture" = shared file (default); "inline" = code snippet for one test'),
        notes:        z.string().optional().describe('Extra context, e.g. "simulates a Stripe card_declined error"'),
      },
    },
    (args) => generateMockTool(args as any),
  );

  server.registerTool(
    'generate_app_knowledge',
    {
      description:
        'Synthesise accumulated knowledge about the app into APP_KNOWLEDGE.md — a per-feature ' +
        'risk document covering known app bugs, recurring coverage gaps, and risk patterns. ' +
        'Once generated, analyze_prd and analyze_coverage automatically read it to enrich ' +
        'their analysis with institutional knowledge about this specific application.',
      inputSchema: {
        output: z.string().optional().describe('Output file path (default: APP_KNOWLEDGE.md in project root)'),
      },
    },
    (args) => generateAppKnowledgeTool(args),
  );

  server.registerTool(
    'plan_e2e',
    {
      description:
        'Plan a multi-page E2E journey before generating it. Asks Claude to decompose the flow into ' +
        'the POMs each step needs (file, new vs existing, methods, page_url), then cross-references ' +
        'the POM Method Index to produce a step → view → POM → exists? → action checklist — flagging ' +
        'methods that already exist elsewhere so generate_test reuses them instead of creating ' +
        'forwarding aliases. Writes no files; one Claude call.',
      inputSchema: {
        description: z.string().describe('The end-to-end journey to plan, e.g. numbered steps across multiple pages.'),
        page_paths: z.array(z.string()).optional().describe('Page paths to inspect live for DOM context, improving plan accuracy.'),
      },
    },
    (args) => planE2eTool(args),
  );

  server.registerTool(
    'init_project',
    {
      description:
        'Bootstrap mcp-qa.config.json plus a minimal pages/fixtures/tests scaffold for a new project. ' +
        'Generates a config with the standard ui/api/e2e/visual registries, a starting riskTiers profile, ' +
        'and a BasePage/SitePage/fixtures placeholder hierarchy — then prints next steps ' +
        '(audit_site, generate_pom, generate_test). Writes no files outside the config\'s directory tree ' +
        'and runs no audit or LLM calls.',
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
    (args) => initProjectTool({
      projectName: args.project_name,
      siteUrl: args.site_url,
      profile: args.profile,
      outputPath: args.output_path,
      force: args.force,
      riskTiers: args.risk_tiers,
    }),
  );

  server.registerTool(
    'review_rules',
    {
      description:
        'List stale rules (referencing POM classes/methods that no longer exist) and ' +
        'near-duplicate rule pairs across learned-rules.md and framework-rules.md — a ' +
        'read-only hygiene report. Pass promote to move a rule from learned-rules.md ' +
        'into framework-rules.md (renumbering the remaining learned rules), making it ' +
        "part of every project's system prompt via this engine. Which rules are " +
        'framework-worthy is a human judgment call — this tool never suggests promotion ' +
        'candidates, only flags hygiene issues.',
      inputSchema: {
        promote: z.string().optional().describe(
          'Rule number in learned-rules.md to promote to framework-rules.md, e.g. "015". ' +
          'When set, performs the promotion and returns a confirmation instead of the hygiene report.',
        ),
      },
    },
    (args) => reviewRulesTool({ promote: args.promote }),
  );

  return server;
}
