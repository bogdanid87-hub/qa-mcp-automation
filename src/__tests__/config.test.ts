import { describe, it, expect } from 'vitest';
import {
  config,
  SITE_URL,
  SITE_HOST,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  TESTS_VISUAL_PATH,
  buildPomHierarchyDescription,
  specKind,
  pomDir,
  fixturesFile,
  relativeImport,
  fixturesImportSpecifier,
  validate,
  type MqaConfig,
} from '../config';

describe('configurable POM dir + fixtures path', () => {
  it('defaults to pages/ and fixtures/index.ts when config omits them', () => {
    expect(pomDir()).toBe('pages');
    expect(fixturesFile()).toBe('fixtures/index.ts');
  });

  it('fixturesImportSpecifier resolves the default fixtures relative to the spec', () => {
    expect(fixturesImportSpecifier('tests/ui/x.spec.ts')).toBe('../../fixtures');
    expect(fixturesImportSpecifier('tests/ui/sub/z.spec.ts')).toBe('../../../fixtures');
  });

  it('relativeImport handles non-standard fixtures locations + drops .ts / /index', () => {
    expect(relativeImport('tests/ui/x.spec.ts', 'fixtures/index.ts')).toBe('../../fixtures');
    expect(relativeImport('tests/ui/x.spec.ts', 'support/fixtures.ts')).toBe('../../support/fixtures');
    expect(relativeImport('e2e/x.spec.ts', 'support/fixtures.ts')).toBe('../support/fixtures');
  });
});

describe('config', () => {
  it('derives SITE_URL and SITE_HOST from project.siteUrl', () => {
    expect(SITE_URL).toBe(config.project.siteUrl);
    expect(SITE_HOST).toBe(new URL(config.project.siteUrl).hostname);
  });

  it('derives registry paths from testing.registries', () => {
    expect(TESTS_UI_PATH.endsWith(config.testing.registries.ui)).toBe(true);
    expect(TESTS_API_PATH.endsWith(config.testing.registries.api)).toBe(true);
    expect(TESTS_E2E_PATH.endsWith(config.testing.registries.e2e)).toBe(true);
    expect(TESTS_VISUAL_PATH.endsWith(config.testing.registries.visual)).toBe(true);
  });
});

describe('specKind', () => {
  const { folders } = config.testing;

  it('classifies a spec path by its configured test folder', () => {
    expect(specKind(`${folders.api}/products.spec.ts`)).toBe('api');
    expect(specKind(`${folders.e2e}/checkout.spec.ts`)).toBe('e2e');
    expect(specKind(`${folders.visual}/cart.spec.ts`)).toBe('visual');
    expect(specKind(`${folders.ui}/contact.spec.ts`)).toBe('ui');
  });

  it('defaults to ui for unrecognised paths', () => {
    expect(specKind('something/else.spec.ts')).toBe('ui');
  });
});

describe('validate', () => {
  // Minimal valid config (mirrors what init_project emits).
  const base = (): MqaConfig => JSON.parse(JSON.stringify(config));

  it('accepts the loaded config', () => {
    expect(() => validate(config)).not.toThrow();
  });

  it('rejects a config missing pom or models (used unconditionally at runtime)', () => {
    const noPom = base();
    // @ts-expect-error — deliberately removing a required field
    delete noPom.pom.baseClass;
    expect(() => validate(noPom)).toThrow(/pom\.baseClass/);

    const noModel = base();
    // @ts-expect-error — deliberately removing a required field
    delete noModel.models.primary;
    expect(() => validate(noModel)).toThrow(/models\.primary/);
  });
});

describe('buildPomHierarchyDescription', () => {
  const description = buildPomHierarchyDescription();

  it('lists the site class and base class with their import paths', () => {
    expect(description).toContain(`(import from './${config.pom.siteClass}')`);
    expect(description).toContain(`(import from './${config.pom.baseClass}')`);
  });

  it('lists every intermediate class with its import path and paths', () => {
    for (const ic of config.pom.intermediateClasses) {
      expect(description).toContain(`(import from '${ic.importFrom}')`);
      for (const p of ic.paths) expect(description).toContain(p);
    }
  });

  it('marks siteClassProvides and intermediate provides as do-not-re-declare', () => {
    expect(description).toContain(`${config.pom.siteClass} already provides (do NOT re-declare in subclasses):`);
    for (const item of config.pom.siteClassProvides) expect(description).toContain(item);

    for (const ic of config.pom.intermediateClasses) {
      if (ic.provides.length === 0) continue;
      expect(description).toContain(`${ic.name} additionally provides (do NOT re-declare in subclasses):`);
      for (const item of ic.provides) expect(description).toContain(item);
    }
  });
});
