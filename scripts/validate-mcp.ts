/**
 * MCP tool schema validation — fast CI check, no live site or API keys needed.
 *
 * Pass 1 — Export check (original):
 *   Imports each tool module and verifies it exports the expected handler function.
 *
 * Pass 2 — Schema compliance check (MCP spec):
 *   Imports TOOL_DEFS from tool-manifest.ts and verifies each tool satisfies the
 *   MCP protocol requirements:
 *     - name:        non-empty, snake_case string
 *     - description: non-empty string (≥ 20 chars)
 *     - inputSchema: every field carries a .describe() annotation so the AI
 *                    knows what each parameter is for; schema converts cleanly
 *                    to JSON Schema draft 2020-12 (the format the MCP spec uses)
 */

import { z } from 'zod';
import { TOOL_DEFS } from '../src/tool-manifest.js';

interface ToolCheck {
  mcp_name: string;
  module: string;
  export: string;
}

const TOOLS: ToolCheck[] = [
  { mcp_name: 'generate_test',         module: '../src/tools/generate-test.js',         export: 'generateTestTool' },
  { mcp_name: 'generate_pom',          module: '../src/tools/generate-pom.js',          export: 'generatePomTool' },
  { mcp_name: 'analyze_prd',           module: '../src/tools/analyze-prd.js',           export: 'analyzePrdTool' },
  { mcp_name: 'analyze_coverage',      module: '../src/tools/analyze-coverage.js',      export: 'analyzeCoverageTool' },
  { mcp_name: 'run_tests',             module: '../src/tools/run-tests.js',             export: 'runTestsTool' },
  { mcp_name: 'list_resources',        module: '../src/tools/list-resources.js',        export: 'listResourcesTool' },
  { mcp_name: 'investigate_and_fix',   module: '../src/tools/investigate-fix.js',       export: 'investigateFixTool' },
  { mcp_name: 'inspect_page',          module: '../src/tools/inspect-page.js',          export: 'inspectPageTool' },
  { mcp_name: 'generate_auth_fixture', module: '../src/tools/generate-auth-fixture.js', export: 'generateAuthFixtureTool' },
  { mcp_name: 'generate_mock',         module: '../src/tools/generate-mock.js',         export: 'generateMockTool' },
  { mcp_name: 'generate_app_knowledge',module: '../src/tools/generate-app-knowledge.js',export: 'generateAppKnowledgeTool' },
];

// ── Pass 1: handler export check ──────────────────────────────────────────────

async function checkExports(): Promise<{ passed: number; errors: string[] }> {
  console.log('Pass 1 — Handler export check\n');
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

  return { passed, errors };
}

// ── Pass 2: MCP schema compliance check ──────────────────────────────────────

function checkSchemas(): { passed: number; errors: string[] } {
  console.log('\nPass 2 — MCP schema compliance check\n');
  let passed = 0;
  const errors: string[] = [];

  // Every tool in TOOL_DEFS must also appear in the TOOLS export list
  const registeredNames = new Set(TOOLS.map(t => t.mcp_name));

  for (const def of TOOL_DEFS) {
    const toolErrors: string[] = [];

    // 1. Name: non-empty, snake_case (MCP convention)
    if (!def.name || !/^[a-z][a-z0-9_]+$/.test(def.name)) {
      toolErrors.push('name must be non-empty and snake_case');
    }

    // 2. Description: non-empty and meaningful (≥ 20 chars)
    if (!def.description || def.description.trim().length < 20) {
      toolErrors.push('description is missing or too short (< 20 chars)');
    }

    // 3. inputSchema fields: every field must have a .describe() annotation so
    //    the AI model understands the parameter's purpose
    const missingDescriptions = Object.entries(def.inputSchema)
      .filter(([, schema]) => !schema.description)
      .map(([field]) => field);

    if (missingDescriptions.length > 0) {
      toolErrors.push(`fields missing .describe() annotation: ${missingDescriptions.join(', ')}`);
    }

    // 4. inputSchema: must convert cleanly to JSON Schema (validates structural
    //    correctness and that the MCP SDK can serialise it for the client)
    try {
      const jsonSchema = z.toJSONSchema(z.object(def.inputSchema));
      if (jsonSchema.type !== 'object') {
        toolErrors.push('inputSchema JSON Schema root is not type "object"');
      }
    } catch (err: any) {
      toolErrors.push(`inputSchema failed JSON Schema conversion: ${err.message}`);
    }

    // 5. Cross-check: every TOOL_DEF must have a corresponding handler entry
    if (!registeredNames.has(def.name)) {
      toolErrors.push('tool is defined in TOOL_DEFS but missing from the TOOLS handler list');
    }

    if (toolErrors.length === 0) {
      console.log(`  ✓  ${def.name}`);
      passed++;
    } else {
      for (const e of toolErrors) errors.push(`${def.name}: ${e}`);
    }
  }

  // 6. Reverse cross-check: every handler must have a TOOL_DEF
  const manifestNames = new Set(TOOL_DEFS.map(d => d.name));
  for (const tool of TOOLS) {
    if (!manifestNames.has(tool.mcp_name)) {
      errors.push(`${tool.mcp_name}: handler registered but missing from TOOL_DEFS in tool-manifest.ts`);
    }
  }

  return { passed, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Validating MCP tools...\n');
  const allErrors: string[] = [];

  const exportResult = await checkExports();
  allErrors.push(...exportResult.errors);

  const schemaResult = checkSchemas();
  allErrors.push(...schemaResult.errors);

  console.log('');

  if (allErrors.length > 0) {
    console.error('❌ Validation failed:');
    for (const e of allErrors) console.error(`   - ${e}`);
    process.exit(1);
  }

  console.log(
    `✅ ${exportResult.passed}/${TOOLS.length} handler exports valid` +
    `   |   ${schemaResult.passed}/${TOOL_DEFS.length} tool schemas MCP-compliant`,
  );
}

main();
