import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { TOOL_DEFS } from './tool-manifest.js';
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

const server = new McpServer({ name: 'qa-mcp-automation', version: '1.0.0' });

// Handler functions keyed by tool name. Argument shapes come from the Zod
// schemas in tool-manifest.ts; casts are intentional where the tool's own
// signature is typed more narrowly.
const HANDLERS: Record<string, (args: any) => any> = {
  generate_test:         (args) => generateTestTool(args),
  analyze_coverage:      (args) => analyzeCoverageTool({
    specPath:      args.spec_path,
    registryPath:  args.registry_path,
    url:           args.url,
    generateGaps:  args.generate_gaps,
    deep:          args.deep,
  }),
  analyze_prd:           (args) => analyzePrdTool({
    prdContent:  args.prd_content,
    outputFile:  args.output_file,
    tier:        args.tier,
    focus:       args.focus,
  }),
  generate_pom:          (args) => generatePomTool(args),
  run_tests:             (args) => runTestsTool(args),
  list_resources:        ()     => listResourcesTool(),
  investigate_and_fix:   (args) => investigateFixTool(args),
  inspect_page:          (args) => inspectPageTool(args),
  generate_auth_fixture: (args) => generateAuthFixtureTool(args),
  generate_mock:         (args) => generateMockTool(args),
  generate_app_knowledge:(args) => generateAppKnowledgeTool(args),
};


for (const def of TOOL_DEFS) {
  server.registerTool(
    def.name,
    { description: def.description, inputSchema: def.inputSchema },
    HANDLERS[def.name],
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('qa-mcp-automation MCP server running\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
