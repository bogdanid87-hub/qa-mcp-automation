import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { buildPomIndex, extractExportedFunctionNames, extractPomMethods, formatPomIndex } from '../tools/pom-index';

const ROOT = process.cwd();

async function readPage(name: string): Promise<string> {
  return readFile(join(ROOT, 'pages', name), 'utf-8');
}

describe('extractPomMethods', () => {
  it('extracts name, params, and return type from a simple method', () => {
    const content = `
export class FooPage {
  async clickSubmit(): Promise<void> {
    await this.submitBtn.click();
  }
}
`;
    expect(extractPomMethods(content)).toEqual([
      { name: 'clickSubmit', params: '', returnType: 'Promise<void>' },
    ]);
  });

  it('extracts params with default values', () => {
    const content = `
export class FooPage {
  async navigate(path: string, dismissOnLoad = true): Promise<void> {
    await this.page.goto(path);
  }
}
`;
    expect(extractPomMethods(content)).toEqual([
      { name: 'navigate', params: 'path: string, dismissOnLoad = true', returnType: 'Promise<void>' },
    ]);
  });

  it('attaches a single-line JSDoc comment as a cleaned doc string', () => {
    const content = `
export class FooPage {
  /**
   * Clicks the submit button and waits for the success modal.
   */
  async submit(): Promise<void> {
    await this.submitBtn.click();
  }
}
`;
    expect(extractPomMethods(content)).toEqual([
      {
        name: 'submit',
        params: '',
        returnType: 'Promise<void>',
        doc: 'Clicks the submit button and waits for the success modal.',
      },
    ]);
  });

  it('joins a multi-line JSDoc comment into one doc string', () => {
    const content = `
export class FooPage {
  /**
   * Fills in the review form and submits it.
   * Waits for the success alert to become visible.
   */
  async submitReview(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }
}
`;
    const [method] = extractPomMethods(content);
    expect(method.doc).toBe('Fills in the review form and submits it. Waits for the success alert to become visible.');
  });

  it('does not attach a class-level doc comment to the first method', () => {
    const content = `
/**
 * Shared base for all pages.
 */
export class FooPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto(): Promise<void> {
    await this.navigate('/foo');
  }
}
`;
    const methods = extractPomMethods(content);
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('goto');
    expect(methods[0].doc).toBeUndefined();
  });

  it('does not bleed a class-level doc comment and field declarations into a later method\'s doc', () => {
    const content = `
/**
 * Shared base for pages that display a product card grid.
 * Owns the product card grid and cart modal.
 */
export class FooPage extends BasePage {
  readonly productCards: Locator;

  constructor(page: Page) {
    super(page);
    this.productCards = page.locator('.product-image-wrapper');
  }

  /**
   * Hover over the product card and click its Add to Cart button.
   */
  async hoverAndAddToCart(index: number): Promise<void> {
    await this.productCards.nth(index).hover();
  }
}
`;
    const methods = extractPomMethods(content);
    expect(methods).toEqual([
      {
        name: 'hoverAndAddToCart',
        params: 'index: number',
        returnType: 'Promise<void>',
        doc: 'Hover over the product card and click its Add to Cart button.',
      },
    ]);
  });

  it('handles a method with no explicit return type', () => {
    const content = `
export class FooPage {
  async legacyMethod() {
    await this.page.goto('/foo');
  }
}
`;
    expect(extractPomMethods(content)).toEqual([
      { name: 'legacyMethod', params: '', returnType: '' },
    ]);
  });

  it('returns an empty array for a locators-only POM', () => {
    const content = `
export class FooPage extends SitePage {
  readonly loginButton: Locator;

  constructor(page: Page) {
    super(page);
    this.loginButton = page.locator('[data-qa="login-button"]');
  }
}
`;
    expect(extractPomMethods(content)).toEqual([]);
  });
});

describe('extractExportedFunctionNames', () => {
  it('extracts exported async helper functions', () => {
    const content = `
import { Page } from '@playwright/test';

export async function loginUser(page: Page, email: string, password: string): Promise<void> {
  // ...
}

export async function addProductAndGoToCart(page: Page, productId: number): Promise<void> {
  // ...
}
`;
    expect(extractExportedFunctionNames(content)).toEqual(['loginUser', 'addProductAndGoToCart']);
  });

  it('extracts non-exported and non-async functions too', () => {
    const content = `
function helper() {}
async function asyncHelper() {}
export function syncExport() {}
`;
    expect(extractExportedFunctionNames(content)).toEqual(['helper', 'asyncHelper', 'syncExport']);
  });
});

describe('buildPomIndex / formatPomIndex against real pages/*.ts files', () => {
  it('indexes a locators-only POM with no methods', async () => {
    const content = await readPage('LoginPage.ts');
    const [entry] = buildPomIndex([{ name: 'pages/LoginPage.ts', content }]);
    expect(entry.className).toBe('LoginPage');
    expect(entry.extendsClass).toBe('SitePage');
    expect(entry.methods).toEqual([]);
  });

  it('indexes BasePage with no extends clause', async () => {
    const content = await readPage('BasePage.ts');
    const [entry] = buildPomIndex([{ name: 'pages/BasePage.ts', content }]);
    expect(entry.className).toBe('BasePage');
    expect(entry.extendsClass).toBeUndefined();
    expect(entry.methods).toEqual([
      { name: 'navigate', params: 'path: string, dismissOnLoad = true', returnType: 'Promise<void>' },
    ]);
  });

  it('indexes ViewCartPage methods with doc summaries', async () => {
    const content = await readPage('ViewCartPage.ts');
    const [entry] = buildPomIndex([{ name: 'pages/ViewCartPage.ts', content }]);
    const names = entry.methods.map((m) => m.name);
    expect(names).toEqual([
      'goto',
      'verifyLoaded',
      'clickProceedToCheckout',
      'getRowProductName',
      'getRowUnitPrice',
      'getRowQuantity',
      'getRowTotal',
      'deleteRow',
    ]);

    const getRowProductName = entry.methods.find((m) => m.name === 'getRowProductName');
    expect(getRowProductName).toEqual({
      name: 'getRowProductName',
      params: 'index: number',
      returnType: 'Promise<string>',
      doc: 'Returns the product name text for the cart row at the given 0-based index.',
    });
  });

  it('formats the full pages/ directory into a POM Method Index with one entry per class', async () => {
    const names = ['BasePage', 'LoginPage', 'ViewCartPage'];
    const files = await Promise.all(
      names.map(async (n) => ({ name: `pages/${n}.ts`, content: await readPage(`${n}.ts`) })),
    );
    const index = buildPomIndex(files);
    const formatted = formatPomIndex(index);

    expect(formatted).toContain('### POM Method Index');
    expect(formatted).toContain('**BasePage** (pages/BasePage.ts)');
    expect(formatted).toContain('**LoginPage** (pages/LoginPage.ts) extends SitePage');
    expect(formatted).toContain('  (no methods — locators only)');
    expect(formatted).toContain(
      '- getRowProductName(index: number): Promise<string> — Returns the product name text for the cart row at the given 0-based index.',
    );
  });

  it('returns an empty string for an empty file list', () => {
    expect(formatPomIndex(buildPomIndex([]))).toBe('');
  });

  it('skips files with no exported class', () => {
    const entries = buildPomIndex([{ name: 'pages/not-a-class.ts', content: 'export const x = 1;' }]);
    expect(entries).toEqual([]);
  });
});
