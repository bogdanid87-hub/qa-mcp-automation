import { describe, it, expect } from 'vitest';
import { compilePom, validatePomSpec, type PomSpec } from '../templates/pom';

const BASE_SPEC: PomSpec = {
  className: 'LoginPage',
  parentClass: 'SitePage',
  locators: [
    { name: 'loginEmailInput', selectorType: 'data-qa', value: 'login-email' },
  ],
};

describe('compilePom', () => {
  it('compiles a data-qa locator into a valid POM file', () => {
    const out = compilePom(BASE_SPEC);
    expect(out).toContain(`import { Page, Locator } from '@playwright/test';`);
    expect(out).toContain(`import { SitePage } from './SitePage';`);
    expect(out).toContain('export class LoginPage extends SitePage {');
    expect(out).toContain('readonly loginEmailInput: Locator;');
    expect(out).toContain(`this.loginEmailInput = page.locator('[data-qa="login-email"]');`);
    expect(out).toContain('constructor(page: Page) {');
    expect(out).toContain('super(page);');
  });

  it('imports the correct parent class for ProductListPage and BasePage', () => {
    const productList = compilePom({ ...BASE_SPEC, parentClass: 'ProductListPage' });
    expect(productList).toContain(`import { ProductListPage } from './ProductListPage';`);
    expect(productList).toContain('export class LoginPage extends ProductListPage {');

    const base = compilePom({ ...BASE_SPEC, parentClass: 'BasePage' });
    expect(base).toContain(`import { BasePage } from './BasePage';`);
    expect(base).toContain('export class LoginPage extends BasePage {');
  });

  it('compiles each selector type to the expected locator expression', () => {
    const spec: PomSpec = {
      className: 'SomePage',
      parentClass: 'SitePage',
      locators: [
        { name: 'dataQa', selectorType: 'data-qa', value: 'submit-button' },
        { name: 'roleNoName', selectorType: 'role', value: 'heading' },
        { name: 'roleWithName', selectorType: 'role', value: 'button', roleName: 'Login' },
        { name: 'labelField', selectorType: 'label', value: 'Email Address' },
        { name: 'placeholderField', selectorType: 'placeholder', value: 'Name' },
        { name: 'textField', selectorType: 'text', value: 'Proceed To Checkout' },
        { name: 'cssField', selectorType: 'css', value: '#quantity' },
      ],
    };
    const out = compilePom(spec);
    expect(out).toContain(`this.dataQa = page.locator('[data-qa="submit-button"]');`);
    expect(out).toContain(`this.roleNoName = page.getByRole('heading');`);
    expect(out).toContain(`this.roleWithName = page.getByRole('button', { name: 'Login' });`);
    expect(out).toContain(`this.labelField = page.getByLabel('Email Address');`);
    expect(out).toContain(`this.placeholderField = page.getByPlaceholder('Name');`);
    expect(out).toContain(`this.textField = page.getByText('Proceed To Checkout');`);
    expect(out).toContain(`this.cssField = page.locator('#quantity');`);
  });

  it('escapes single quotes in selector values', () => {
    const spec: PomSpec = {
      className: 'SomePage',
      parentClass: 'SitePage',
      locators: [
        { name: 'apostrophe', selectorType: 'text', value: "Don't show again" },
      ],
    };
    const out = compilePom(spec);
    expect(out).toContain(`this.apostrophe = page.getByText('Don\\'t show again');`);
  });

  it('produces output with no markdown fences or prose', () => {
    const out = compilePom(BASE_SPEC);
    expect(out).not.toContain('```');
    expect(out.trimStart().startsWith('import')).toBe(true);
  });
});

describe('validatePomSpec', () => {
  it('rejects an invalid class name', () => {
    expect(() => validatePomSpec({ ...BASE_SPEC, className: '123Bad' })).toThrow(/invalid class name/);
    expect(() => validatePomSpec({ ...BASE_SPEC, className: 'My Page' })).toThrow(/invalid class name/);
  });

  it('rejects an unrecognised parent class', () => {
    expect(() =>
      validatePomSpec({ ...BASE_SPEC, parentClass: 'Bogus' as PomSpec['parentClass'] }),
    ).toThrow(/invalid parent class/);
  });

  it('rejects an empty locators array', () => {
    expect(() => validatePomSpec({ ...BASE_SPEC, locators: [] })).toThrow(/no locators/);
  });

  it('rejects an invalid locator name', () => {
    const spec: PomSpec = { ...BASE_SPEC, locators: [{ name: '2bad', selectorType: 'css', value: '#x' }] };
    expect(() => validatePomSpec(spec)).toThrow(/invalid locator name/);
  });

  it('rejects an unrecognised selector type', () => {
    const spec: PomSpec = {
      ...BASE_SPEC,
      locators: [{ name: 'thing', selectorType: 'xpath' as PomSpec['locators'][number]['selectorType'], value: '//div' }],
    };
    expect(() => validatePomSpec(spec)).toThrow(/invalid selector type/);
  });

  it('rejects an empty selector value', () => {
    const spec: PomSpec = { ...BASE_SPEC, locators: [{ name: 'thing', selectorType: 'css', value: '' }] };
    expect(() => validatePomSpec(spec)).toThrow(/empty selector value/);
  });

  it('accepts a valid spec without throwing', () => {
    expect(() => validatePomSpec(BASE_SPEC)).not.toThrow();
  });
});
