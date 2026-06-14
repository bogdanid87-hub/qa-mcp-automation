/**
 * Extracts method signatures from Page Object Model files so callers can see
 * what already exists without paying for full file content — used to build
 * the "POM Method Index" shown to Claude (avoids near-duplicate/alias
 * methods) and to guard against an LLM-generated POM update silently
 * dropping existing methods.
 */

export interface PomMethod {
  name: string;
  params: string;
  returnType: string;
  doc?: string;
}

export interface PomIndexEntry {
  file: string;
  className: string;
  extendsClass?: string;
  methods: PomMethod[];
}

export interface PomLocator {
  name: string;
  selector: string;
}

export interface OwnedElementsEntry {
  /** Class name, e.g. "SitePage" or "ProductListPage". */
  name: string;
  /** Path relative to the project root, e.g. "pages/SitePage.ts". */
  file: string;
  content: string;
}

const CLASS_RE = /export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/;

const METHOD_RE = /async\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?\s*\{/g;

// Matches `this.someLocator = page.locator('selector');` — a single string-literal
// selector with no second argument (e.g. `{ hasText: ... }`). Locators built with
// options or variables are skipped — the deterministic collision check can't reason
// about a `hasText` filter without re-implementing it.
const LOCATOR_RE = /this\.(\w+)\s*=\s*page\.locator\(\s*(['"`])((?:\\.|(?!\2).)*)\2\s*\)/g;

function cleanDoc(rawDoc: string): string {
  return rawDoc
    .split('\n')
    .map((line) => line.replace(/^\s*\/?\*+\/?\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Returns the JSDoc comment immediately preceding `pos` (only whitespace in
 * between), or '' if there isn't one. Searching backward for the nearest
 * `/**` avoids matching across unrelated class-level doc comments and member
 * declarations that sit between them and the method.
 */
function extractPrecedingDoc(content: string, pos: number): string {
  const before = content.slice(0, pos).replace(/\s+$/, '');
  if (!before.endsWith('*/')) return '';
  const commentStart = before.lastIndexOf('/**');
  if (commentStart === -1) return '';
  return cleanDoc(before.slice(commentStart));
}

/** Extract async method signatures (name, params, return type, doc summary) from a POM file's content. */
export function extractPomMethods(content: string): PomMethod[] {
  return [...content.matchAll(METHOD_RE)].map((match) => {
    const [, name, params, returnType] = match;
    const method: PomMethod = { name, params: params.trim(), returnType: (returnType ?? '').trim() };
    const doc = extractPrecedingDoc(content, match.index ?? 0);
    if (doc) method.doc = doc;
    return method;
  });
}

/** Extract `this.x = page.locator('...')` assignments with a single string-literal selector. */
export function extractPomLocators(content: string): PomLocator[] {
  return [...content.matchAll(LOCATOR_RE)].map((m) => ({ name: m[1], selector: m[3] }));
}

/** Extract top-level exported function names from a helpers file's content. */
export function extractExportedFunctionNames(content: string): string[] {
  return [...content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'default');
}

/**
 * Render a "selectors/methods already owned by parent classes" block for
 * generate_pom's system prompt, derived from each entry's actual file content
 * via extractPomLocators/extractPomMethods. Returns '' if no entry has any
 * locators or methods (e.g. a fresh project's placeholder SitePage.ts).
 *
 * Coverage matches extractPomLocators's documented limitation — locators built
 * with getByRole/.filter()/variables aren't listed, so the prompt also tells
 * the model to check the file directly for anything that looks related.
 */
export function formatOwnedElements(entries: OwnedElementsEntry[]): string {
  const blocks: string[] = [];
  for (const entry of entries) {
    const locators = extractPomLocators(entry.content);
    const methods = extractPomMethods(entry.content);
    if (locators.length === 0 && methods.length === 0) continue;

    const lines = [`**${entry.name}** (${entry.file}) already owns — do NOT re-declare these under a different name:`];
    for (const loc of locators) lines.push(`  ${loc.selector} → ${loc.name}`);
    for (const m of methods) lines.push(`  ${m.name}(${m.params})`);
    blocks.push(lines.join('\n'));
  }
  if (blocks.length === 0) return '';

  return [
    '',
    '## Elements already owned by parent classes',
    '',
    ...blocks,
    '',
    'Before writing any locator, check whether its selector matches one of the entries above — if yes, skip it ' +
      'entirely instead of re-declaring it under a different name. Additional nav/footer/modal locators may exist ' +
      "on these classes beyond what's listed above — check the file directly if a selector you're about to add " +
      'looks related.',
  ].join('\n');
}

/** Build a method-signature index for a set of POM files. Files with no `export class` are skipped. */
export function buildPomIndex(files: { name: string; content: string }[]): PomIndexEntry[] {
  const entries: PomIndexEntry[] = [];
  for (const file of files) {
    const classMatch = file.content.match(CLASS_RE);
    if (!classMatch) continue;
    entries.push({
      file: file.name,
      className: classMatch[1],
      extendsClass: classMatch[2],
      methods: extractPomMethods(file.content),
    });
  }
  return entries;
}

/** Render a POM index as a compact markdown block for inclusion in generation context. */
export function formatPomIndex(entries: PomIndexEntry[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = ['### POM Method Index', ''];
  for (const entry of entries) {
    const extendsSuffix = entry.extendsClass ? ` extends ${entry.extendsClass}` : '';
    lines.push(`**${entry.className}** (${entry.file})${extendsSuffix}`);
    if (entry.methods.length === 0) {
      lines.push('  (no methods — locators only)');
    } else {
      for (const m of entry.methods) {
        const returnSuffix = m.returnType ? `: ${m.returnType}` : '';
        const docSuffix = m.doc ? ` — ${m.doc}` : '';
        lines.push(`  - ${m.name}(${m.params})${returnSuffix}${docSuffix}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
