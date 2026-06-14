/**
 * Typed template for compiling locator-only Page Object Model files.
 *
 * `generate_pom` asks the model for a structured description of a page's
 * locators (`PomSpec`) rather than raw TypeScript file text. `compilePom`
 * then renders that description through this fixed template — so the
 * output can never contain markdown fences, prose, or malformed TS, no
 * matter what the model returns.
 */

import { config } from '../config.js';

export type SelectorType = 'data-qa' | 'role' | 'label' | 'placeholder' | 'text' | 'css';

export interface PomLocatorSpec {
  /** camelCase property name, e.g. "emailInput". */
  name: string;
  selectorType: SelectorType;
  /**
   * Meaning depends on selectorType:
   *  - data-qa     → the data-qa attribute value (without brackets/quotes)
   *  - role        → the ARIA role, e.g. "button"
   *  - label       → the label text for getByLabel
   *  - placeholder → the placeholder text for getByPlaceholder
   *  - text        → the visible text for getByText
   *  - css         → a raw CSS selector for page.locator(), e.g. "#quantity"
   */
  value: string;
  /** For selectorType "role": the accessible name passed as { name } to getByRole. */
  roleName?: string;
}

export interface PomSpec {
  className: string;
  parentClass: string;
  locators: PomLocatorSpec[];
}

/**
 * Maps each parent class this project's POMs can extend to its import path —
 * derived from config.pom so a project with different/no intermediate classes
 * doesn't get a hardcoded ProductListPage/SitePage/BasePage union.
 */
const PARENT_IMPORT_PATH: Record<string, string> = {
  [config.pom.baseClass]: `./${config.pom.baseClass}`,
  [config.pom.siteClass]: `./${config.pom.siteClass}`,
  ...Object.fromEntries(config.pom.intermediateClasses.map((ic) => [ic.name, ic.importFrom])),
};

const SELECTOR_TYPES: SelectorType[] = ['data-qa', 'role', 'label', 'placeholder', 'text', 'css'];

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function escapeSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function locatorExpression(loc: PomLocatorSpec): string {
  const value = escapeSingleQuoted(loc.value);
  switch (loc.selectorType) {
    case 'data-qa':
      return `page.locator('[data-qa="${value}"]')`;
    case 'role': {
      const name = loc.roleName ? `, { name: '${escapeSingleQuoted(loc.roleName)}' }` : '';
      return `page.getByRole('${value}'${name})`;
    }
    case 'label':
      return `page.getByLabel('${value}')`;
    case 'placeholder':
      return `page.getByPlaceholder('${value}')`;
    case 'text':
      return `page.getByText('${value}')`;
    case 'css':
      return `page.locator('${value}')`;
  }
}

/**
 * Validate a structured POM spec, throwing a descriptive error for any field
 * that wouldn't compile to valid TypeScript — invalid identifiers, an
 * unrecognised parent class, an unrecognised selector type, or an empty
 * selector value.
 */
export function validatePomSpec(spec: PomSpec): void {
  if (!IDENTIFIER_RE.test(spec.className)) {
    throw new Error(`invalid class name: "${spec.className}"`);
  }
  if (!(spec.parentClass in PARENT_IMPORT_PATH)) {
    throw new Error(`invalid parent class: "${spec.parentClass}"`);
  }
  if (!Array.isArray(spec.locators) || spec.locators.length === 0) {
    throw new Error('no locators provided');
  }
  for (const loc of spec.locators) {
    if (!IDENTIFIER_RE.test(loc.name)) {
      throw new Error(`invalid locator name: "${loc.name}"`);
    }
    if (!SELECTOR_TYPES.includes(loc.selectorType)) {
      throw new Error(`invalid selector type "${loc.selectorType}" for locator "${loc.name}"`);
    }
    if (!loc.value) {
      throw new Error(`empty selector value for locator "${loc.name}"`);
    }
  }
}

/**
 * Compile a structured POM spec into a Page Object Model file. Because the
 * output is built from this fixed template rather than emitted directly by
 * the model, it cannot contain markdown fences, prose, or malformed
 * TypeScript — only the values inside `spec` vary.
 */
export function compilePom(spec: PomSpec): string {
  validatePomSpec(spec);

  const lines: string[] = [
    `import { Page, Locator } from '@playwright/test';`,
    `import { ${spec.parentClass} } from '${PARENT_IMPORT_PATH[spec.parentClass]}';`,
    '',
    `export class ${spec.className} extends ${spec.parentClass} {`,
    ...spec.locators.map((loc) => `  readonly ${loc.name}: Locator;`),
    '',
    '  constructor(page: Page) {',
    '    super(page);',
    ...spec.locators.map((loc) => `    this.${loc.name} = ${locatorExpression(loc)};`),
    '  }',
    '}',
    '',
  ];

  return lines.join('\n');
}
