import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { generateTestTool } from './tools/generate-test.js';
import { generateApiTestTool } from './tools/generate-api-test.js';
import { generatePomTool } from './tools/generate-pom.js';
import { analyzePrdTool } from './tools/analyze-prd.js';
import { analyzeCoverageTool } from './tools/analyze-coverage.js';
import { runTestsTool } from './tools/run-tests.js';
import { listResourcesTool } from './tools/list-resources.js';
import { investigateFixTool } from './tools/investigate-fix.js';
import { inspectPageTool } from './tools/inspect-page.js';
import { generateAuthFixtureTool } from './tools/generate-auth-fixture.js';
import { generateMockTool } from './tools/generate-mock.js';

const server = new McpServer({ name: 'qa-mcp-automation', version: '1.0.0' });

server.registerTool(
  'generate_test',
  {
    description:
      'Generate a Playwright test (and POM page object if needed) for automationexercise.com. ' +
      'Provide test steps as a description; Claude Sonnet 4.6 writes the code following project conventions and saves the files.',
    inputSchema: {
      description: z.string().describe('Test steps or description of what to test. May be plain text or a numbered list.'),
      test_name: z.string().optional().describe('Names the test() and describe() blocks. Does not control the filename.'),
      spec_file: z.string().optional().describe('Target spec file path, e.g. "tests/ui/cart.spec.ts" or "tests/e2e/place-order.spec.ts". Created if it does not exist; new test is added if it does.'),
      page_paths: z.array(z.string()).optional().describe('Page paths to inspect live for accurate locators, e.g. ["/contact_us", "/login"]. The server navigates each page headlessly and extracts real DOM elements before generating the POM.'),
    },
  },
  (args) => generateTestTool({ ...args, spec_file: (args as { spec_file?: string }).spec_file }),
);

server.registerTool(
  'generate_api_test',
  {
    description:
      'Generate a Playwright API test (no browser — uses the request fixture) for automationexercise.com. ' +
      'Uses the local LLM (Ollama) when available for zero API cost; falls back to Claude automatically. ' +
      'Tests are written to tests/api/ and results are recorded in TEST_API.md. ' +
      'Describe the endpoint to test; the tool writes the spec, runs it, and attempts auto-fix on failure.',
    inputSchema: {
      description: z.string().describe('What API endpoint or scenario to test. Include the endpoint URL, HTTP method, expected status code, and key response fields to validate.'),
      test_name: z.string().optional().describe('Hint for naming the test() and describe() blocks.'),
      spec_file: z.string().optional().describe('Target spec file, e.g. "tests/api/products.spec.ts". Inferred from the description if omitted.'),
    },
  },
  (args) => generateApiTestTool(args),
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
      'Filters out tests that already exist in TEST_CASES.md so the output is a genuine gap list. ' +
      'Writes suggestions to prd-tests.txt in the same batch format as my-test.txt so you can run ' +
      '`npm run generate -- --file prd-tests.txt` directly without any copy-pasting.',
    inputSchema: {
      prd_content: z.string().describe('The PRD text to analyse. Paste the full document, a feature section, or a list of user stories.'),
      output_file: z.string().optional().describe('Output file path. Defaults to prd-tests.txt in the project root.'),
      tier: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional().describe('Only generate tests at these risk levels, e.g. ["critical", "high"]. Omits all others.'),
      focus: z.array(z.string()).optional().describe('Only generate tests for these feature areas, e.g. ["checkout", "authentication"]. Omits all others.'),
    },
  },
  (args) => analyzePrdTool({
    prdContent: args.prd_content,
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
    description: 'Run Playwright tests (Chromium) and return the output.',
    inputSchema: {
      pattern: z.string().optional().describe('Optional file path or glob, e.g. "tests/contactUs.spec.ts"'),
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('qa-mcp-automation MCP server running\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
