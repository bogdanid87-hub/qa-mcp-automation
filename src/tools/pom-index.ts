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

const CLASS_RE = /export\s+class\s+(\w+)(?:\s+extends\s+(\w+))?/;

const METHOD_RE = /async\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?\s*\{/g;

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

/** Extract top-level exported function names from a helpers file's content. */
export function extractExportedFunctionNames(content: string): string[] {
  return [...content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'default');
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
