import { describe, it, expect } from 'vitest';
import {
  detectPomHierarchy,
  detectFixtureShape,
  detectAuthoringIdioms,
  detectRunnerConfig,
  stripComments,
  extractLocatorFieldNames,
  buildPomConfig,
  computePomApply,
  type PomHierarchy,
} from '../tools/learn-conventions';

// ── POM hierarchy ────────────────────────────────────────────────────────────

const BASE_PAGE = `export class BasePage {
  async navigate(path: string) { await this.page.goto(path); }
}`;

const SITE_PAGE = `import { BasePage } from './BasePage';
export class SitePage extends BasePage {
  readonly navHome: Locator;
  readonly navProducts: Locator;
  readonly footer: Locator;
  async clickHome() {}
}`;

const PRODUCT_LIST = `import { SitePage } from './SitePage';
export class ProductListPage extends SitePage {
  async addToCart() {}
}`;

const HOME_PAGE = `import { ProductListPage } from './ProductListPage';
export class HomePage extends ProductListPage {
  async goto() {}
}`;

describe('detectPomHierarchy — two-tier (BasePage → SitePage)', () => {
  const pages = [
    { name: 'pages/BasePage.ts', content: BASE_PAGE },
    { name: 'pages/SitePage.ts', content: SITE_PAGE },
    { name: 'pages/ProductListPage.ts', content: PRODUCT_LIST },
    { name: 'pages/HomePage.ts', content: HOME_PAGE },
  ];

  it('picks BasePage as base and SitePage as the nav-owning site class (not collapsed)', () => {
    const h = detectPomHierarchy(pages)!;
    expect(h.baseClass).toBe('BasePage');
    expect(h.siteClass).toBe('SitePage');
    expect(h.collapsed).toBe(false);
  });

  it('lists ProductListPage as an intermediate with the right import path, and HomePage as a leaf', () => {
    const h = detectPomHierarchy(pages)!;
    expect(h.intermediateClasses.map((c) => c.name)).toContain('ProductListPage');
    expect(h.intermediateClasses.find((c) => c.name === 'ProductListPage')?.importFrom).toBe('./ProductListPage');
    expect(h.leafPages).toContain('HomePage');
    expect(h.siteClassProvides).toEqual(expect.arrayContaining(['navHome', 'navProducts', 'clickHome']));
  });
});

describe('detectPomHierarchy — collapsed (nav on the base class)', () => {
  // AutomationExercise shape: BasePage carries the nav; no separate SitePage.
  const collapsedBase = `export class BasePage {
    readonly navHome: Locator;
    readonly navProducts: Locator;
    readonly navCart: Locator;
    async navigate(path: string) {}
  }`;
  const pages = [
    { name: 'pages/BasePage.ts', content: collapsedBase },
    { name: 'pages/ProductListingPage.ts', content: 'import { BasePage } from "./BasePage";\nexport class ProductListingPage extends BasePage { async sort() {} }' },
    { name: 'pages/HomePage.ts', content: 'import { ProductListingPage } from "./ProductListingPage";\nexport class HomePage extends ProductListingPage {}' },
  ];

  it('maps siteClass to the base class and flags collapsed', () => {
    const h = detectPomHierarchy(pages, ['SidebarComponent'])!;
    expect(h.baseClass).toBe('BasePage');
    expect(h.siteClass).toBe('BasePage');
    expect(h.collapsed).toBe(true);
    expect(h.components).toEqual(['SidebarComponent']);
  });

  it('returns null when there are no page classes', () => {
    expect(detectPomHierarchy([{ name: 'pages/empty.ts', content: '// nothing' }])).toBeNull();
  });
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

describe('detectFixtureShape', () => {
  const fixtures = `import { test as base } from './routeBlocker';
type Fixtures = {
  loginPage: LoginPage;
  apiClient: ApiClient;
};
export const test = base.extend<Fixtures>({});
export { expect } from '@playwright/test';`;

  it('detects exports, injected fixtures, base extension, and absent trackCleanup', () => {
    const f = detectFixtureShape(fixtures);
    expect(f.exportsTest).toBe(true);
    expect(f.exportsExpect).toBe(true);
    expect(f.baseExtension).toBe('./routeBlocker');
    expect(f.hasTrackCleanup).toBe(false);
    expect(f.injectedFixtures.map((x) => x.name)).toEqual(['loginPage', 'apiClient']);
  });

  it('detects trackCleanup when present', () => {
    expect(detectFixtureShape('export const test = base.extend<{ trackCleanup: Fn }>({});').hasTrackCleanup).toBe(true);
  });
});

// ── Authoring idioms ─────────────────────────────────────────────────────────

describe('detectAuthoringIdioms', () => {
  it('reports fixture-injection as dominant when it strongly outnumbers instantiation', () => {
    const specs = [
      { path: 'tests/ui/a.spec.ts', content: "import { test } from '../../fixtures/index';\ntest('x', async ({ contactPage }) => {});" },
      { path: 'tests/ui/b.spec.ts', content: "import { test } from '../../fixtures/index';\ntest('y', async ({ homePage }) => {});" },
      { path: 'tests/ui/c.spec.ts', content: "import { test } from '../../fixtures/index';\ntest('z', async ({ cartPage }) => {});" },
      { path: 'tests/ui/d.spec.ts', content: "test('w', async ({ page }) => { const p = new HomePage(page); });" },
    ];
    const i = detectAuthoringIdioms(specs);
    expect(i.pomConsumption).toBe('fixture-injection');
    expect(i.pomCounts).toEqual({ injected: 3, instantiated: 1 });
    expect(i.testImportPath).toBe('../../fixtures/index');
  });

  it('detects ApiClient vs raw request and the data source', () => {
    const specs = [
      { path: 'tests/api/user.api.spec.ts', content: "import { USERS } from '../../data/testData';\ntest('a', async ({ apiClient }) => { await apiClient.verifyLogin(); });" },
      { path: 'tests/api/p.api.spec.ts', content: "test('b', async ({ request }) => { await request.post('/x'); });" },
    ];
    const i = detectAuthoringIdioms(specs);
    expect(i.apiPattern).toBe('mixed');
    expect(i.apiCounts).toEqual({ apiClient: 1, request: 1 });
    expect(i.dataSources).toContain('../../data/testData');
  });
});

// ── Runner ───────────────────────────────────────────────────────────────────

describe('detectRunnerConfig + stripComments', () => {
  const config = `export default defineConfig({
  globalSetup: './global-setup.ts',
  testDir: './tests',
  projects: [
    { name: 'chromium', use: { storageState: 'storageState.chromium.json' } },
    // { name: 'firefox', use: {} },
    // { name: 'webkit', use: {} },
    { name: 'api', testDir: './tests/api' },
  ],
});`;

  it('ignores commented-out projects', () => {
    const r = detectRunnerConfig(config);
    expect(r.projects).toEqual(['chromium', 'api']);
    expect(r.hasFirefox).toBe(false);
    expect(r.hasWebkit).toBe(false);
    expect(r.hasChromium).toBe(true);
  });

  it('detects the setup style and storage state', () => {
    const r = detectRunnerConfig(config);
    expect(r.setupStyle).toBe('globalSetup');
    expect(r.storageState).toBe('storageState.chromium.json');
  });

  it('stripComments removes block and full-line comments', () => {
    expect(stripComments('a\n// gone\nb /* x */')).toContain('a');
    expect(stripComments('a\n// gone\nb')).not.toContain('gone');
  });
});

describe('extractLocatorFieldNames', () => {
  it('extracts readonly Locator field names', () => {
    expect(extractLocatorFieldNames('readonly navHome: Locator;\nreadonly footer: Locator;\nfoo: string;'))
      .toEqual(['navHome', 'footer']);
  });
});

// ── buildPomConfig / computePomApply (PR 2) ──────────────────────────────────

const HIERARCHY: PomHierarchy = {
  baseClass: 'BasePage',
  siteClass: 'BasePage',
  collapsed: true,
  intermediateClasses: [{ name: 'ProductListingPage', importFrom: './ProductListingPage', extendsClass: 'BasePage', provides: ['sort', 'filter'] }],
  siteClassProvides: ['navHome', 'navProducts'],
  leafPages: ['HomePage'],
  components: ['SidebarComponent'],
};

describe('buildPomConfig', () => {
  it('maps a detected hierarchy to a config pom block', () => {
    const pom = buildPomConfig(HIERARCHY);
    expect(pom.baseClass).toBe('BasePage');
    expect(pom.siteClass).toBe('BasePage');
    expect(pom.siteClassProvides).toEqual(['navHome', 'navProducts']);
    expect(pom.intermediateClasses[0]).toMatchObject({ name: 'ProductListingPage', importFrom: './ProductListingPage', provides: ['sort', 'filter'], paths: [] });
    expect(pom.intermediateClasses[0].description).toContain('detected');
  });

  it('preserves human-authored description/paths for an existing intermediate class', () => {
    const pom = buildPomConfig(HIERARCHY, {
      intermediateClasses: [{ name: 'ProductListingPage', importFrom: './ProductListingPage', description: 'Listing pages', paths: ['/products', '/category'], provides: [] }],
    });
    expect(pom.intermediateClasses[0].description).toBe('Listing pages');
    expect(pom.intermediateClasses[0].paths).toEqual(['/products', '/category']);
    // provides is re-detected from code, not preserved
    expect(pom.intermediateClasses[0].provides).toEqual(['sort', 'filter']);
  });
});

describe('computePomApply', () => {
  it('reports the diff and produces a merged config when the hierarchy differs', () => {
    const current = { project: { name: 'x' }, pom: { baseClass: 'BasePage', siteClass: 'SitePage', siteClassProvides: [], intermediateClasses: [] } };
    const apply = computePomApply(current, HIERARCHY);
    expect(apply.changed).toBe(true);
    expect(apply.summary.join(' ')).toContain('siteClass: SitePage → BasePage');
    expect(apply.summary.join(' ')).toContain('ProductListingPage');
    // merged config keeps other top-level keys and swaps in the new pom
    const merged = JSON.parse(apply.newConfigJson);
    expect(merged.project.name).toBe('x');
    expect(merged.pom.siteClass).toBe('BasePage');
  });

  it('reports no change when config.pom already matches', () => {
    const current = { pom: buildPomConfig(HIERARCHY) };
    expect(computePomApply(current, HIERARCHY).changed).toBe(false);
  });
});
