/**
 * Single-source CLI help: render a CLI's `--help` Options from the SAME
 * tool-manifest.ts descriptions the MCP surface uses, so the chat tool description
 * and the terminal `--help` can't drift in wording (the recurring two-surface tax).
 *
 * Each CliHelpSpec declares, once, how a tool's schema params map to CLI flags. The
 * validate-mcp guard (Pass 3) asserts that mapping covers every schema param, so a
 * new tool param can't be silently missing from the CLI.
 */
import { TOOL_DEFS } from '../tool-manifest.js';

export interface CliFlag {
  /** CLI flag name (without the leading --), e.g. "url". */
  flag: string;
  /** True for value-less boolean flags (e.g. --deep). */
  boolean?: boolean;
}

export interface CliHelpSpec {
  /** Tool name in tool-manifest.ts, e.g. "generate_mock". */
  tool: string;
  /** npm script name, e.g. "generate_mock". */
  script: string;
  /** schema param → CLI flag. Omit a param only if it's listed in `mcpOnly`. */
  flags: Record<string, CliFlag>;
  /** Extra CLI convenience flag → the param it feeds (e.g. "pattern" → "urlPattern"). */
  aliases?: Record<string, string>;
  /** Params intentionally NOT exposed on the CLI (programmatic/MCP only). */
  mcpOnly?: string[];
  /** Example invocation lines (already prefixed with the command). */
  examples?: string[];
}

function paramDescription(tool: string, param: string): string {
  const def = TOOL_DEFS.find((d) => d.name === tool);
  const schema = def?.inputSchema[param] as { description?: string } | undefined;
  return schema?.description ?? '';
}

/** Build the `--help` text for a CLI from its spec + the shared manifest descriptions. */
export function buildToolHelp(spec: CliHelpSpec): string {
  const lines: string[] = [`Usage: npm run ${spec.script} -- [options]`, ''];

  const optionLines: string[] = [];
  for (const [param, { flag, boolean }] of Object.entries(spec.flags)) {
    const left = `--${flag}${boolean ? '' : ' <value>'}`;
    optionLines.push(`  ${left.padEnd(22)}${paramDescription(spec.tool, param)}`);
  }
  if (optionLines.length > 0) lines.push('Options:', ...optionLines);

  if (spec.aliases && Object.keys(spec.aliases).length > 0) {
    const byParam: Record<string, string[]> = {};
    for (const [alias, param] of Object.entries(spec.aliases)) (byParam[param] ??= []).push(alias);
    const aliasLines = Object.entries(byParam).map(
      ([param, aliases]) => `  --${aliases.join(', --')} (alias for --${spec.flags[param].flag})`,
    );
    lines.push('', 'Aliases:', ...aliasLines);
  }

  if (spec.examples && spec.examples.length > 0) {
    lines.push('', 'Examples:', ...spec.examples.map((e) => `  ${e}`));
  }

  return lines.join('\n') + '\n';
}

// ── Registered specs (the CLIs whose help is single-sourced) ─────────────────────
// As more CLIs migrate, add their spec here — the validate-mcp guard checks each
// spec covers all of its tool's schema params.

/** Render the `--help` text for a registered CLI by tool name. */
export function cliHelp(tool: string): string {
  const spec = CLI_HELP_SPECS.find((s) => s.tool === tool);
  if (!spec) throw new Error(`No CLI help spec registered for tool "${tool}"`);
  return buildToolHelp(spec);
}

export const CLI_HELP_SPECS: CliHelpSpec[] = [
  {
    tool: 'generate_mock',
    script: 'generate_mock',
    flags: {
      name:         { flag: 'name' },
      urlPattern:   { flag: 'url' },
      method:       { flag: 'method' },
      status:       { flag: 'status' },
      responseBody: { flag: 'response' },
      scope:        { flag: 'scope' },
      notes:        { flag: 'notes' },
    },
    aliases: { pattern: 'urlPattern', body: 'responseBody' },
    examples: [
      `npm run generate_mock -- --name stripeSuccess --url '**/api/charges' --response '{ "status": "succeeded" }'`,
      `npm run generate_mock -- --name apiError --url '**/api/products' --status 500 --scope inline`,
    ],
  },
  {
    tool: 'analyze_coverage',
    script: 'analyze_coverage',
    flags: {
      spec_path:     { flag: 'spec' },
      registry_path: { flag: 'registry' },
      url:           { flag: 'url' },
      generate_gaps: { flag: 'gaps', boolean: true },
      deep:          { flag: 'deep', boolean: true },
    },
    examples: [
      'npm run analyze_coverage -- --spec tests/ui/contact.spec.ts',
      'npm run analyze_coverage -- --registry TESTS_UI.md --gaps',
      'npm run analyze_coverage                              # all registries',
    ],
  },
];
