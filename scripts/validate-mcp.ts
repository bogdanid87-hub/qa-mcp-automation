/**
 * MCP tool schema validation — fast CI check, no live site or API keys needed.
 *
 * Imports each tool module and verifies it exports the expected handler function.
 * If any module fails to import (broken schema, bad TypeScript, missing export),
 * this script exits non-zero and CI fails immediately with a clear message.
 */

interface ToolCheck {
  mcp_name: string;
  module: string;
  export: string;
}

const TOOLS: ToolCheck[] = [
  { mcp_name: 'generate_test',         module: '../src/tools/generate-test.js',        export: 'generateTestTool' },
  { mcp_name: 'generate_pom',          module: '../src/tools/generate-pom.js',         export: 'generatePomTool' },
  { mcp_name: 'analyze_prd',           module: '../src/tools/analyze-prd.js',          export: 'analyzePrdTool' },
  { mcp_name: 'analyze_coverage',      module: '../src/tools/analyze-coverage.js',     export: 'analyzeCoverageTool' },
  { mcp_name: 'run_tests',             module: '../src/tools/run-tests.js',            export: 'runTestsTool' },
  { mcp_name: 'list_resources',        module: '../src/tools/list-resources.js',       export: 'listResourcesTool' },
  { mcp_name: 'investigate_and_fix',   module: '../src/tools/investigate-fix.js',      export: 'investigateFixTool' },
  { mcp_name: 'inspect_page',          module: '../src/tools/inspect-page.js',         export: 'inspectPageTool' },
  { mcp_name: 'generate_auth_fixture', module: '../src/tools/generate-auth-fixture.js',export: 'generateAuthFixtureTool' },
  { mcp_name: 'generate_mock',         module: '../src/tools/generate-mock.js',        export: 'generateMockTool' },
  { mcp_name: 'generate_app_knowledge',module: '../src/tools/generate-app-knowledge.js',export: 'generateAppKnowledgeTool' },
];

async function main() {
  console.log('Validating MCP tool exports...\n');
  let passed = 0;
  const errors: string[] = [];

  for (const check of TOOLS) {
    try {
      const mod = await import(check.module);
      if (typeof mod[check.export] !== 'function') {
        errors.push(`${check.mcp_name}: export '${check.export}' is not a function`);
      } else {
        console.log(`  ✓  ${check.mcp_name}`);
        passed++;
      }
    } catch (err: any) {
      errors.push(`${check.mcp_name}: import failed — ${err.message}`);
    }
  }

  console.log('');

  if (errors.length > 0) {
    console.error('❌ Validation failed:');
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }

  console.log(`✅ ${passed}/${TOOLS.length} MCP tool modules validated`);
}

main();
