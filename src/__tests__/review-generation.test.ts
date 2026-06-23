import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PomIndexEntry } from '../tools/pom-index';
import {
  checkLocatorCollisions,
  checkForwardingAliases,
  checkFixtureUsage,
  checkPomDirectGoto,
  checkNotVisibleFootgun,
  reviewGeneratedFiles,
} from '../tools/review-generation';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

afterEach(() => {
  mockCreate.mockReset();
  vi.unstubAllEnvs();
});

describe('checkLocatorCollisions', () => {
  const pomFiles = [{
    path: 'pages/FixturePage.ts',
    content: `
export class FixturePage extends SitePage {
  readonly successMessage: Locator;
  readonly title: Locator;

  constructor(page: Page) {
    super(page);
    this.successMessage = page.locator('.alert-success.alert');
    this.title = page.locator('h1.title');
  }
}
`,
  }];

  it('flags a bare/compound class selector that resolves to more than one element', () => {
    const html = `
      <html><body>
        <div class="alert-success alert">Saved!</div>
        <div class="alert-success alert">Also saved!</div>
      </body></html>
    `;
    const issues = checkLocatorCollisions(pomFiles, [{ url: '/fixture', html }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      category: 'locator-collision',
      file: 'pages/FixturePage.ts',
    });
    expect(issues[0].message).toContain('.alert-success.alert');
    expect(issues[0].message).toContain('this.successMessage');
    expect(issues[0].message).toContain('2 elements');
  });

  it('does not flag a selector that resolves to exactly one element', () => {
    const html = `
      <html><body>
        <div class="alert-success alert">Saved!</div>
      </body></html>
    `;
    const issues = checkLocatorCollisions(pomFiles, [{ url: '/fixture', html }]);
    expect(issues).toEqual([]);
  });

  it('skips element-scoped class selectors entirely (h1.title is the recommended fix, not a violation)', () => {
    const html = `
      <html><body>
        <h1 class="title">Page A</h1>
        <h1 class="title">Page B</h1>
      </body></html>
    `;
    const issues = checkLocatorCollisions(pomFiles, [{ url: '/fixture', html }]);
    expect(issues).toEqual([]);
  });

  it('returns no issues when no pages were inspected', () => {
    const issues = checkLocatorCollisions(pomFiles, []);
    expect(issues).toEqual([]);
  });
});

describe('checkForwardingAliases', () => {
  it('flags a new method that near-duplicates an existing method on another POM class', () => {
    const pomFiles = [{
      path: 'pages/CartPage.ts',
      content: `
export class CartPage extends SitePage {
  async getProductName(index: number): Promise<string> {
    return (await this.cartRows.nth(index).locator('.product-name').textContent()) ?? '';
  }
}
`,
    }];
    const index: PomIndexEntry[] = [
      {
        file: 'pages/ViewCartPage.ts',
        className: 'ViewCartPage',
        extendsClass: 'SitePage',
        methods: [
          { name: 'getRowProductName', params: 'index: number', returnType: 'Promise<string>' },
        ],
      },
      {
        file: 'pages/CartPage.ts',
        className: 'CartPage',
        extendsClass: 'SitePage',
        methods: [
          { name: 'getProductName', params: 'index: number', returnType: 'Promise<string>' },
        ],
      },
    ];

    const issues = checkForwardingAliases(pomFiles, index);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      category: 'forwarding-alias',
      file: 'pages/CartPage.ts',
    });
    expect(issues[0].message).toContain('getProductName(index: number)');
    expect(issues[0].message).toContain('ViewCartPage.getRowProductName(index: number)');
    expect(issues[0].message).toContain('pages/ViewCartPage.ts');
  });

  it('does not flag methods with unrelated names or incompatible signatures', () => {
    const pomFiles = [{
      path: 'pages/CartPage.ts',
      content: `
export class CartPage extends SitePage {
  async clickProceedToCheckout(): Promise<void> {
    await this.proceedToCheckoutBtn.click();
  }
  async getRowTotal(index: number): Promise<number> {
    return 0;
  }
}
`,
    }];
    const index: PomIndexEntry[] = [
      {
        file: 'pages/ViewCartPage.ts',
        className: 'ViewCartPage',
        extendsClass: 'SitePage',
        methods: [
          { name: 'verifyLoaded', params: '', returnType: 'Promise<void>' },
          { name: 'getRowProductName', params: 'index: number', returnType: 'Promise<string>' },
        ],
      },
    ];

    expect(checkForwardingAliases(pomFiles, index)).toEqual([]);
  });
});

describe('checkFixtureUsage', () => {
  it('flags `new SomePage(page)` in a spec file', () => {
    const specFiles = [{
      path: 'tests/ui/cart.spec.ts',
      content: `
test('adds to cart', async ({ page }) => {
  const cartPage = new CartPage(page);
  await cartPage.goto();
});
`,
    }];
    const issues = checkFixtureUsage(specFiles);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      category: 'fixture-usage',
      file: 'tests/ui/cart.spec.ts',
    });
    expect(issues[0].message).toContain('new CartPage(page)');
  });

  it('does not flag a spec that obtains its POM via a fixture', () => {
    const specFiles = [{
      path: 'tests/ui/cart.spec.ts',
      content: `
test('adds to cart', async ({ page, cartPage }) => {
  await cartPage.goto();
});
`,
    }];
    expect(checkFixtureUsage(specFiles)).toEqual([]);
  });
});

describe('checkPomDirectGoto', () => {
  it('flags a POM method (not navigate) calling page.goto()', () => {
    const pom = `export class P {
      async navigate(path) { await this.page.goto(path); }
      async goto() { await this.page.goto('/'); }
    }`;
    const issues = checkPomDirectGoto([{ path: 'pages/P.ts', content: pom }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('goto()');
    expect(issues[0].category).toBe('pom-direct-goto');
  });

  it('does not flag a POM that only uses this.navigate()', () => {
    const pom = `export class P {
      async goto() { await this.navigate('/'); }
    }`;
    expect(checkPomDirectGoto([{ path: 'pages/P.ts', content: pom }])).toHaveLength(0);
  });
});

describe('checkNotVisibleFootgun', () => {
  it('flags .not.toBeVisible() right after an action with no wait', () => {
    const spec = `test('x', async ({ page }) => {
      await page.click('#submit');
      await expect(page.locator('#err')).not.toBeVisible();
    });`;
    expect(checkNotVisibleFootgun([{ path: 'tests/ui/x.spec.ts', content: spec }])).toHaveLength(1);
  });

  it('does not flag when a wait/positive assertion precedes it', () => {
    const spec = `test('x', async ({ page }) => {
      await page.click('#submit');
      await expect(page.locator('#ok')).toBeVisible();
      await expect(page.locator('#modal')).not.toBeVisible();
    });`;
    expect(checkNotVisibleFootgun([{ path: 'tests/ui/x.spec.ts', content: spec }])).toHaveLength(0);
  });
});

describe('reviewGeneratedFiles', () => {
  it('includes issues from a mocked LLM review pass alongside deterministic checks', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        issues: [
          { category: 'hardcoded-data', file: 'pages/LoginPage.ts', message: 'Asserts a hardcoded email address — capture it at runtime instead.' },
        ],
      }) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    // LoginPage.ts is locators-only (no async methods, no spec file) — deterministic
    // checks contribute nothing, isolating the LLM-sourced issue for this assertion.
    const result = await reviewGeneratedFiles(['pages/LoginPage.ts']);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.issues).toEqual([
      { severity: 'info', category: 'hardcoded-data', file: 'pages/LoginPage.ts', message: 'Asserts a hardcoded email address — capture it at runtime instead.' },
    ]);
  });

  it('skips the LLM pass when ANTHROPIC_API_KEY is unset, returning only deterministic issues', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    const result = await reviewGeneratedFiles(['pages/LoginPage.ts']);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.issues).toEqual([]);
  });
});
