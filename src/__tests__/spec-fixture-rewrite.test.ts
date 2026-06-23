import { describe, it, expect } from 'vitest';
import { buildFixtureMap, pomPrimaryPath, rewriteNewPomFixtures, rewriteFixturesImport } from '../tools/spec-fixture-rewrite';

describe('buildFixtureMap', () => {
  it('maps each fixture class to its fixture name', () => {
    const fixtures = `type Fixtures = {
  loginPage: LoginPage;
  cartPage: CartPage;
  apiClient: ApiClient;
};`;
    const map = buildFixtureMap(fixtures);
    expect(map.get('CartPage')).toBe('cartPage');
    expect(map.get('LoginPage')).toBe('loginPage');
    expect(map.get('ApiClient')).toBe('apiClient');
  });
});

describe('pomPrimaryPath', () => {
  it('extracts the navigate() path', () => {
    expect(pomPrimaryPath("async goto() { await this.navigate('/'); }")).toBe('/');
    expect(pomPrimaryPath("async goto() { await this.navigate('/view_cart'); }")).toBe('/view_cart');
    expect(pomPrimaryPath('no navigate here')).toBeNull();
  });
});

describe('rewriteFixturesImport', () => {
  it('repoints test/expect from @playwright/test to the fixtures module', () => {
    const spec = "import { test, expect } from '@playwright/test';\ntest('x', async () => {});";
    const r = rewriteFixturesImport(spec, '../../fixtures');
    expect(r.changed).toBe(true);
    expect(r.content).toContain("import { test, expect } from '../../fixtures';");
    expect(r.content).not.toContain("@playwright/test");
  });

  it('keeps non-fixture names (Page, APIResponse) on a separate @playwright/test import', () => {
    const spec = "import { test, expect, type APIResponse } from '@playwright/test';";
    const r = rewriteFixturesImport(spec, '../../fixtures');
    expect(r.content).toContain("import { test, expect } from '../../fixtures';");
    expect(r.content).toContain("import { type APIResponse } from '@playwright/test';");
  });

  it('leaves a spec that only imports non-fixture names alone', () => {
    const spec = "import type { APIResponse } from '@playwright/test';";
    const r = rewriteFixturesImport(spec, '../../fixtures');
    expect(r.changed).toBe(false);
  });

  it('leaves a spec already importing from fixtures alone', () => {
    const spec = "import { test, expect } from '../../fixtures';";
    expect(rewriteFixturesImport(spec, '../../fixtures').changed).toBe(false);
  });
});

describe('rewriteNewPomFixtures', () => {
  const map = new Map([['CartPage', 'cartPage'], ['HomePage', 'homePage']]);

  it('rewrites a concrete `new CartPage(page)` to the fixture and drops the import + unused page', () => {
    const spec = `import { test, expect } from '../../fixtures';
import { CartPage } from '../../pages/CartPage';

test('adds to cart', async ({ page }) => {
  const cart = new CartPage(page);
  await cart.open();
  await expect(cart.rows).toHaveCount(1);
});`;
    const { content, rewrites } = rewriteNewPomFixtures(spec, map);
    expect(content).toContain('async ({ cartPage }) =>');
    expect(content).toContain('await cartPage.open();');
    expect(content).toContain('cartPage.rows');
    expect(content).not.toContain('new CartPage');
    expect(content).not.toContain("import { CartPage }");
    expect(rewrites).toHaveLength(1);
  });

  it('keeps page in the destructure when the body still uses it', () => {
    const spec = `test('x', async ({ page }) => {
  const cart = new CartPage(page);
  await page.goto('/');
  await cart.open();
});`;
    const { content } = rewriteNewPomFixtures(spec, map);
    expect(content).toContain('async ({ page, cartPage }) =>');
    expect(content).toContain("await page.goto('/');");
  });

  it('resolves a base class with no direct fixture via resolveAncestor (the new BasePage case)', () => {
    const spec = `import { test, expect } from '../../fixtures/index';
import { BasePage } from '../../pages/BasePage';
import { USERS } from '../../data/testData';

test('subscribe on home', async ({ page }) => {
  const basePage = new BasePage(page);
  await basePage.navigate();
  await basePage.subscribeToNewsletter(USERS.existing.email);
  await expect(basePage.subscriptionSuccessMessage).toBeVisible();
});`;
    const { content } = rewriteNewPomFixtures(spec, map, (c) => (c === 'BasePage' ? 'homePage' : undefined));
    expect(content).toContain('async ({ homePage }) =>');
    expect(content).toContain('await homePage.navigate();');
    expect(content).toContain('homePage.subscribeToNewsletter(USERS.existing.email)');
    expect(content).not.toContain('new BasePage');
    expect(content).not.toContain('import { BasePage }');
    expect(content).toContain("import { USERS }"); // unrelated import untouched
  });

  it('leaves an unresolvable instantiation untouched (never breaks the spec)', () => {
    const spec = `test('x', async ({ page }) => {
  const widget = new UnknownPage(page);
  await widget.do();
});`;
    const { content, rewrites } = rewriteNewPomFixtures(spec, map);
    expect(content).toContain('new UnknownPage(page)');
    expect(rewrites).toHaveLength(0);
  });

  it('scopes var replacement per callback (two tests, different fixtures)', () => {
    const spec = `test('a', async ({ page }) => {
  const p = new CartPage(page);
  await p.open();
});
test('b', async ({ page }) => {
  const p = new HomePage(page);
  await p.goto();
});`;
    const { content } = rewriteNewPomFixtures(spec, map);
    expect(content).toContain('await cartPage.open();');
    expect(content).toContain('await homePage.goto();');
  });
});
