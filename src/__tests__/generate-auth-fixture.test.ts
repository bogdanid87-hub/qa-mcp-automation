import { describe, it, expect } from 'vitest';
import { fixtureNameInUse, ensurePageImport } from '../tools/generate-auth-fixture';

const FIXTURES = `import { test as base } from '@playwright/test';
import { AdminPage } from '../pages/AdminPage';

type PageFixtures = {
  adminPage: AdminPage;
};

export const test = base.extend<PageFixtures>({
  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },
});

export { expect } from '@playwright/test';
`;

describe('fixtureNameInUse', () => {
  it('detects an existing fixture name (type and extend body)', () => {
    expect(fixtureNameInUse(FIXTURES, 'adminPage')).toBe(true);
  });

  it('returns false when the name is not declared', () => {
    expect(fixtureNameInUse(FIXTURES, 'loggedInPage')).toBe(false);
  });

  it('respects word boundaries (superAdminPage is not adminPage)', () => {
    const f = 'type T = { superAdminPage: Page };';
    expect(fixtureNameInUse(f, 'adminPage')).toBe(false);
  });
});

describe('ensurePageImport', () => {
  it('adds a Page import when the fixture type uses generic Page', () => {
    const out = ensurePageImport(FIXTURES, 'loggedInPage: Page');
    expect(out).toContain("import type { Page } from '@playwright/test';");
    // inserted right after the first import line, not duplicated
    expect(out.match(/@playwright\/test/g)?.length).toBe(3); // base import + new Page import + expect re-export
  });

  it('is a no-op when Page is already imported', () => {
    const withPage = `import { test as base, type Page } from '@playwright/test';\n`;
    expect(ensurePageImport(withPage, 'loggedInPage: Page')).toBe(withPage);
  });

  it('is a no-op when the fixture type does not use Page', () => {
    expect(ensurePageImport(FIXTURES, 'adminPage: AdminPage')).toBe(FIXTURES);
  });
});
