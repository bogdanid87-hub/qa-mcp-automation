import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Bootstrap import safety ──────────────────────────────────────────────────
// init_project must run in a project that has NO mcp-qa.config.json yet (it creates
// one), so nothing in its import graph may pull in config.ts's eager singleton load.
describe('init_project bootstrap import safety', () => {
  it('init-project imports the schema (not the config singleton)', async () => {
    const src = await readFile(join(__dirname, '../tools/init-project.ts'), 'utf-8');
    expect(src).toContain("from '../config-schema.js'");
    expect(src).not.toMatch(/from '\.\.\/config\.js'/);
  });

  it('init-project-templates use the import-free requirements template', async () => {
    const src = await readFile(join(__dirname, '../tools/init-project-templates.ts'), 'utf-8');
    expect(src).toContain("from './requirements-template.js'");
    // requirements-registry transitively loads config via test-registry — must not be used here.
    expect(src).not.toContain("from './requirements-registry.js'");
  });
});

import { validate } from '../config';
import { buildMqaConfig, initProjectTool, PROFILE_RISK_TIERS, type InitProjectArgs } from '../tools/init-project';

let dir: string;
let outputPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'init-project-'));
  outputPath = join(dir, 'mcp-qa.config.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BASE_ARGS: InitProjectArgs = {
  projectName: 'demo-shop',
  siteUrl: 'https://example.com',
};

// ── buildMqaConfig ───────────────────────────────────────────────────────────

describe('buildMqaConfig', () => {
  it('produces a config that passes validate() for the generic profile (default)', () => {
    const config = buildMqaConfig(BASE_ARGS);
    expect(() => validate(config)).not.toThrow();
    expect(config.project).toEqual({ name: 'demo-shop', siteUrl: 'https://example.com' });
    expect(config.riskTiers).toEqual(PROFILE_RISK_TIERS.generic);
    expect(config.pom).toEqual({
      baseClass: 'BasePage',
      siteClass: 'SitePage',
      siteClassProvides: [],
      intermediateClasses: [],
    });
  });

  it('produces a config that passes validate() for the ecommerce profile', () => {
    const config = buildMqaConfig({ ...BASE_ARGS, profile: 'ecommerce' });
    expect(() => validate(config)).not.toThrow();
    expect(config.riskTiers).toEqual(PROFILE_RISK_TIERS.ecommerce);
  });

  it('always uses the 4-registry ui/api/e2e/visual shape', () => {
    const config = buildMqaConfig(BASE_ARGS);
    expect(config.testing.folders).toEqual({ ui: 'tests/ui', api: 'tests/api', e2e: 'tests/e2e', visual: 'tests/visual' });
    expect(config.testing.registries).toEqual({
      ui: 'TESTS_UI.md', api: 'TESTS_API.md', e2e: 'TESTS_E2E.md', visual: 'TESTS_VISUAL.md',
    });
  });

  it('merges per-tier riskTiers overrides on top of the profile, leaving other tiers at defaults', () => {
    const config = buildMqaConfig({ ...BASE_ARGS, riskTiers: { critical: ['nuke', 'irreversible'] } });
    expect(config.riskTiers.critical).toEqual(['nuke', 'irreversible']);
    expect(config.riskTiers.high).toEqual(PROFILE_RISK_TIERS.generic.high);
    expect(config.riskTiers.medium).toEqual(PROFILE_RISK_TIERS.generic.medium);
    expect(config.riskTiers.low).toEqual(PROFILE_RISK_TIERS.generic.low);
  });
});

// ── initProjectTool ──────────────────────────────────────────────────────────

describe('initProjectTool', () => {
  it('writes a valid mcp-qa.config.json that round-trips through validate()', async () => {
    const result = await initProjectTool({ ...BASE_ARGS, outputPath });
    expect(result.content[0].text).toContain(`Wrote ${outputPath}`);

    const written = JSON.parse(await readFile(outputPath, 'utf-8'));
    expect(() => validate(written)).not.toThrow();
    expect(written.project.name).toBe('demo-shop');
  });

  it('scaffolds the directory/file skeleton relative to the output dir', async () => {
    await initProjectTool({ ...BASE_ARGS, outputPath });

    for (const rel of ['tests/ui/.gitkeep', 'tests/api/.gitkeep', 'tests/e2e/.gitkeep', 'tests/visual/.gitkeep', 'test-data/.gitkeep']) {
      await expect(readFile(join(dir, rel), 'utf-8')).resolves.toBe('');
    }

    const basePage = await readFile(join(dir, 'pages/BasePage.ts'), 'utf-8');
    expect(basePage).toContain('class BasePage');
    // navigate must accept the dismissOnLoad arg the system prompt documents
    expect(basePage).toContain('navigate(path: string, dismissOnLoad');

    // Runnable Playwright setup: config (with all three browsers) + global setup.
    const pwConfig = await readFile(join(dir, 'playwright.config.ts'), 'utf-8');
    expect(pwConfig).toContain('defineConfig');
    for (const project of ['chromium', 'firefox', 'webkit', 'setup', 'visual']) {
      expect(pwConfig).toContain(`name: '${project}'`);
    }
    expect(pwConfig).toContain("readFileSync('mcp-qa.config.json'");

    const globalSetup = await readFile(join(dir, 'tests/global.setup.ts'), 'utf-8');
    expect(globalSetup).toContain('save guest storage state');

    const tsconfig = JSON.parse(await readFile(join(dir, 'tsconfig.json'), 'utf-8'));
    expect(tsconfig.compilerOptions.strict).toBe(true);
    // Node types so playwright.config.ts / global.setup.ts (process, __dirname, fs) type-check
    expect(tsconfig.compilerOptions.types).toContain('node');

    const gitignore = await readFile(join(dir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('test-data/.auth/');

    const sitePage = await readFile(join(dir, 'pages/SitePage.ts'), 'utf-8');
    expect(sitePage).toContain('extends BasePage');

    const fixtures = await readFile(join(dir, 'fixtures/index.ts'), 'utf-8');
    expect(fixtures).toContain('base.extend');

    const learnedRules = await readFile(join(dir, 'learned-rules.md'), 'utf-8');
    expect(learnedRules).toContain('<!-- rules-start -->');
    expect(learnedRules).toContain('<!-- rules-end -->');

    const requirements = await readFile(join(dir, 'REQUIREMENTS.md'), 'utf-8');
    expect(requirements).toContain('<!-- requirements-start -->');
    expect(requirements).toContain('<!-- requirements-end -->');

    const startHere = await readFile(join(dir, 'workspace/START_HERE.md'), 'utf-8');
    expect(startHere).toContain('# Start Here');

    const myTest = await readFile(join(dir, 'workspace/my-test.txt'), 'utf-8');
    expect(myTest).toContain('Describe your test scenario here...');

    const prd = await readFile(join(dir, 'workspace/prd.md'), 'utf-8');
    expect(prd).toContain('Replace this with your PRD content...');
  });

  it('reports created vs skipped scaffold entries', async () => {
    const result = await initProjectTool({ ...BASE_ARGS, outputPath });
    const text = result.content[0].text;
    expect(text).toContain('✅ created  pages/BasePage.ts');
    expect(text).toContain('✅ created  pages/SitePage.ts');
    expect(text).toContain('✅ created  fixtures/index.ts');
    expect(text).toContain('✅ created  learned-rules.md');
    expect(text).toContain('✅ created  workspace/START_HERE.md');
    expect(text).toContain('✅ created  workspace/my-test.txt');
    expect(text).toContain('✅ created  workspace/prd.md');
  });

  it('refuses to overwrite an existing config without force, and skips scaffolding', async () => {
    await writeFile(outputPath, '{"existing": true}', 'utf-8');

    const result = await initProjectTool({ ...BASE_ARGS, outputPath });
    expect(result.content[0].text).toMatch(/already exists/);
    expect(result.content[0].text).toContain('force: true');

    expect(await readFile(outputPath, 'utf-8')).toBe('{"existing": true}');
    await expect(readFile(join(dir, 'pages/BasePage.ts'), 'utf-8')).rejects.toThrow();
  });

  it('overwrites the config with force: true', async () => {
    await writeFile(outputPath, '{"existing": true}', 'utf-8');

    const result = await initProjectTool({ ...BASE_ARGS, outputPath, force: true });
    expect(result.content[0].text).toContain(`Wrote ${outputPath}`);

    const written = JSON.parse(await readFile(outputPath, 'utf-8'));
    expect(written.project.name).toBe('demo-shop');
  });

  it('never overwrites an existing scaffold file, even with force: true', async () => {
    await mkdir(join(dir, 'pages'), { recursive: true });
    await mkdir(join(dir, 'workspace'), { recursive: true });
    await writeFile(join(dir, 'pages/SitePage.ts'), '// my custom SitePage\n', 'utf-8');
    await writeFile(join(dir, 'learned-rules.md'), '# My existing rules\n', 'utf-8');
    await writeFile(join(dir, 'workspace/my-test.txt'), '# my custom test description\n', 'utf-8');

    const result = await initProjectTool({ ...BASE_ARGS, outputPath, force: true });
    expect(result.content[0].text).toContain('⏭️  skipped (already exists)  pages/SitePage.ts');
    expect(result.content[0].text).toContain('⏭️  skipped (already exists)  learned-rules.md');
    expect(result.content[0].text).toContain('⏭️  skipped (already exists)  workspace/my-test.txt');

    expect(await readFile(join(dir, 'pages/SitePage.ts'), 'utf-8')).toBe('// my custom SitePage\n');
    expect(await readFile(join(dir, 'learned-rules.md'), 'utf-8')).toBe('# My existing rules\n');
    expect(await readFile(join(dir, 'workspace/my-test.txt'), 'utf-8')).toBe('# my custom test description\n');
  });

  it('rejects an invalid siteUrl without writing anything', async () => {
    const result = await initProjectTool({ ...BASE_ARGS, siteUrl: 'not a url', outputPath });
    expect(result.content[0].text).toMatch(/not a valid URL/);
    await expect(readFile(outputPath, 'utf-8')).rejects.toThrow();
  });

  it('rejects an empty projectName', async () => {
    const result = await initProjectTool({ ...BASE_ARGS, projectName: '  ', outputPath });
    expect(result.content[0].text).toMatch(/projectName is required/);
    await expect(readFile(outputPath, 'utf-8')).rejects.toThrow();
  });
});
