import { describe, it, expect } from 'vitest';
import { fixtureNameInUse, ensurePageImport, inferLoginSelectors } from '../tools/generate-auth-fixture';
import type { PageSnapshot } from '../tools/inspect-page';

type El = PageSnapshot['elements'][number];
const snap = (elements: El[]): PageSnapshot =>
  ({ path: '/login', url: 'https://x/login', title: 'Login', headings: [], forms: [], elements });

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

describe('inferLoginSelectors', () => {
  it('infers email (type=email), password, and an explicit submit button', () => {
    const r = inferLoginSelectors(snap([
      { selector: '#Email', tag: 'input', type: 'email', id: 'Email' },
      { selector: '#Password', tag: 'input', type: 'password', id: 'Password' },
      { selector: '#login-btn', tag: 'button', type: 'submit', id: 'login-btn', text: 'Log in' },
    ]));
    expect(r.emailSelector).toBe('#Email');
    expect(r.passwordSelector).toBe('#Password');
    expect(r.submitSelector).toBe('#login-btn');
    expect(r.notes).toHaveLength(0);
  });

  it('infers a username field via name/id hint and a submit button by its text', () => {
    const r = inferLoginSelectors(snap([
      { selector: '#username', tag: 'input', type: 'text', id: 'username' },
      { selector: '#pass', tag: 'input', type: 'password', id: 'pass' },
      { selector: '#go', tag: 'button', id: 'go', text: 'Sign In' },
    ]));
    expect(r.emailSelector).toBe('#username');
    expect(r.passwordSelector).toBe('#pass');
    expect(r.submitSelector).toBe('#go');
  });

  it('falls back to the first text input for email when there is no hint', () => {
    const r = inferLoginSelectors(snap([
      { selector: '#u', tag: 'input', type: 'text', id: 'u' },
      { selector: '#p', tag: 'input', type: 'password', id: 'p' },
    ]));
    expect(r.emailSelector).toBe('#u');
  });

  it('uses a generic submit selector + note when no submit button is in the snapshot', () => {
    const r = inferLoginSelectors(snap([
      { selector: '#Email', tag: 'input', type: 'email', id: 'Email' },
      { selector: '#Password', tag: 'input', type: 'password', id: 'Password' },
    ]));
    expect(r.submitSelector).toBe('button[type="submit"], input[type="submit"]');
    expect(r.notes.join(' ')).toMatch(/generic submit/i);
  });

  it('notes a missing password field', () => {
    const r = inferLoginSelectors(snap([
      { selector: '#Email', tag: 'input', type: 'email', id: 'Email' },
    ]));
    expect(r.passwordSelector).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/password field/i);
  });
});
