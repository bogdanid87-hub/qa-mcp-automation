import { describe, it, expect } from 'vitest';
import { cliHelp, CLI_HELP_SPECS } from '../lib/cli-help';
import { TOOL_DEFS } from '../tool-manifest';

describe('buildToolHelp / cliHelp', () => {
  it('renders a flag line for every param, using the manifest descriptions', () => {
    const help = cliHelp('generate_mock');
    for (const flag of ['--name', '--url', '--method', '--status', '--response', '--scope', '--notes']) {
      expect(help).toContain(flag);
    }
    // Wording is single-sourced from the manifest's param .describe() text.
    expect(help).toContain('URL pattern to intercept');
    expect(help).toContain('Describe the response body');
  });

  it('lists aliases', () => {
    const help = cliHelp('generate_mock');
    expect(help).toMatch(/--pattern.*alias for --url/);
    expect(help).toMatch(/--body.*alias for --response/);
  });

  it('marks boolean flags without a <value> placeholder', () => {
    const help = cliHelp('analyze_coverage');
    expect(help).toMatch(/--gaps\s{2,}/); // no "<value>" after a boolean flag
    expect(help).toContain('--spec <value>');
  });

  it('throws for an unregistered tool', () => {
    expect(() => cliHelp('not_a_tool')).toThrow(/No CLI help spec/);
  });
});

// Mirror of the validate-mcp Pass-3 guard, so coverage drift is also caught in unit tests.
describe('CLI_HELP_SPECS cover their tool params', () => {
  it.each(CLI_HELP_SPECS.map((s) => [s.tool, s] as const))('%s', (_tool, spec) => {
    const def = TOOL_DEFS.find((d) => d.name === spec.tool);
    expect(def, `tool ${spec.tool} exists in TOOL_DEFS`).toBeTruthy();
    const params = new Set(Object.keys(def!.inputSchema));
    const covered = new Set([...Object.keys(spec.flags), ...(spec.mcpOnly ?? [])]);
    expect([...params].filter((p) => !covered.has(p)), 'every param mapped or mcpOnly').toEqual([]);
    expect([...covered].filter((p) => !params.has(p)), 'no unknown params referenced').toEqual([]);
  });
});
