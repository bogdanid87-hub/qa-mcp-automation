import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Regression lock for the configurable POM dir + fixtures path. Config is a
 * per-process singleton loaded from cwd, so the only faithful way to prove the
 * accessors and the generation prompt read a NON-DEFAULT config (not just the
 * defaults the in-suite config.test.ts can reach) is to run them in a child
 * process whose cwd holds a hand-written config with non-standard paths.
 */
const SRC = resolve(__dirname, '..'); // engine src/
const TSX_CLI = require.resolve('tsx/cli');

const NON_DEFAULT_CONFIG = {
  project: { name: 'fake', siteUrl: 'https://example.com' },
  testing: {
    folders: { ui: 'tests/ui', api: 'tests/api', e2e: 'tests/e2e', visual: 'tests/visual' },
    registries: { ui: 'TESTS_UI.md', api: 'TESTS_API.md', e2e: 'TESTS_E2E.md', visual: 'TESTS_VISUAL.md' },
    fixtures: 'support/fixtures.ts', // ← non-default
  },
  pom: { baseClass: 'BasePage', siteClass: 'SitePage', siteClassProvides: [], intermediateClasses: [], dir: 'src/pages' }, // ← non-default dir
  riskTiers: { critical: ['x'], high: ['x'], medium: ['x'], low: ['x'] },
  models: { primary: 'claude-sonnet-4-6', local: 'q' },
};

describe('configurable POM dir + fixtures path — reads a non-default config', () => {
  it('accessors and getSystemPrompt reflect the hand-set config (not the defaults)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mqa-cfg-'));
    try {
      writeFileSync(join(dir, 'mcp-qa.config.json'), JSON.stringify(NON_DEFAULT_CONFIG));

      // Runs in a child process with cwd=dir so config.ts loads our config.
      const probe = `(async () => {
        const c = await import(${JSON.stringify(join(SRC, 'config.ts'))});
        const s = await import(${JSON.stringify(join(SRC, 'prompts/system.ts'))});
        const prompt = await s.getSystemPrompt();
        console.log(JSON.stringify({
          pomDir: c.pomDir(),
          fixturesFile: c.fixturesFile(),
          imp: c.fixturesImportSpecifier('tests/ui/x.spec.ts'),
          promptHasSrcPages: prompt.includes('src/pages/'),
          promptHasSupportFixtures: prompt.includes('../../support/fixtures'),
          promptHasBarePages: /(^|[^/])\\bpages\\//.test(prompt),
        }));
      })();`;

      const out = execFileSync(process.execPath, [TSX_CLI, '-e', probe], { cwd: dir, encoding: 'utf-8' });
      const r = JSON.parse(out.trim().split('\n').pop()!);

      expect(r.pomDir).toBe('src/pages');
      expect(r.fixturesFile).toBe('support/fixtures.ts');
      expect(r.imp).toBe('../../support/fixtures');
      expect(r.promptHasSrcPages).toBe(true);
      expect(r.promptHasSupportFixtures).toBe(true);
      expect(r.promptHasBarePages).toBe(false); // no hardcoded pages/ leaked through
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
