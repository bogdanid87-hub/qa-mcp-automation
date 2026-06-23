import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
import { learnConventionsTool } from './tools/learn-conventions.js';
import { planE2eTool } from './tools/plan-e2e.js';
import { initProjectTool } from './tools/init-project.js';
import { reviewRulesTool } from './tools/review-rules.js';

/**
 * Maps each tool name to its handler. The tool name, description, and input
 * schema are the single source of truth in tool-manifest.ts (TOOL_DEFS); this
 * map only wires the MCP arguments through to each tool function, translating
 * snake_case MCP fields to the function's camelCase parameters where needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HANDLERS: Record<string, (args: any) => unknown> = {
  generate_test:         (args) => generateTestTool(args),
  generate_pom:          (args) => generatePomTool(args),
  analyze_prd:           (args) => analyzePrdTool({
    prdContent: args.prd_content,
    specPath:   args.spec_path,
    outputFile: args.output_file,
    tier:       args.tier,
    focus:      args.focus,
  }),
  analyze_coverage:      (args) => analyzeCoverageTool({
    specPath:     args.spec_path,
    registryPath: args.registry_path,
    url:          args.url,
    generateGaps: args.generate_gaps,
    deep:         args.deep,
  }),
  run_tests:             (args) => runTestsTool(args),
  list_resources:        () => listResourcesTool(),
  investigate_and_fix:   (args) => investigateFixTool(args),
  inspect_page:          (args) => inspectPageTool(args),
  generate_auth_fixture: (args) => generateAuthFixtureTool(args),
  generate_mock:         (args) => generateMockTool(args),
  generate_app_knowledge:(args) => generateAppKnowledgeTool(args),
  learn_conventions:     (args) => learnConventionsTool({
    output:           args.output,
    applyPom:         args.apply_pom,
    applyConventions: args.apply_conventions,
    write:            args.write,
  }),
  plan_e2e:              (args) => planE2eTool(args),
  init_project:          (args) => initProjectTool({
    projectName: args.project_name,
    siteUrl:     args.site_url,
    profile:     args.profile,
    outputPath:  args.output_path,
    force:       args.force,
    riskTiers:   args.risk_tiers,
  }),
  review_rules:          (args) => reviewRulesTool({ promote: args.promote }),
};

/** Builds the MCP server with all 15 tools registered. Caller connects it to a transport. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'qa-mcp-automation', version: '1.0.0' });

  for (const def of TOOL_DEFS) {
    const handler = HANDLERS[def.name];
    if (!handler) throw new Error(`No handler registered for tool "${def.name}"`);
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler as any,
    );
  }

  return server;
}
