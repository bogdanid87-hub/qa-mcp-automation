import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { generateTestTool } from './tools/generate-test.js';
import { runTestsTool } from './tools/run-tests.js';
import { listResourcesTool } from './tools/list-resources.js';
import { investigateFixTool } from './tools/investigate-fix.js';
import { inspectPageTool } from './tools/inspect-page.js';

const server = new McpServer({ name: 'qa-mcp-automation', version: '1.0.0' });

server.registerTool(
  'generate_test',
  {
    description:
      'Generate a Playwright test (and POM page object if needed) for automationexercise.com. ' +
      'Provide test steps as a description; Claude Sonnet 4.6 writes the code following project conventions and saves the files.',
    inputSchema: {
      description: z.string().describe('Test steps or description of what to test. May be plain text or a numbered list.'),
      test_name: z.string().optional().describe('Optional hint for naming the test file, e.g. "register" → tests/register.spec.ts'),
      page_paths: z.array(z.string()).optional().describe('Page paths to inspect live for accurate locators, e.g. ["/contact_us", "/login"]. The server navigates each page headlessly and extracts real DOM elements before generating the POM.'),
    },
  },
  (args) => generateTestTool(args),
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('qa-mcp-automation MCP server running\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
