import { readdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { buildPomIndex, extractPomMethods, formatPomIndex, type PomIndexEntry } from './pom-index.js';
import { pomDir, fixturesFile } from '../config.js';

const ROOT = process.cwd();
/** Directories scanned for project context — POM dir + fixtures dir + tests + utils, configurable. */
function dirsToScan(): string[] {
  return [...new Set([pomDir(), dirname(fixturesFile()), 'tests', 'utils'])];
}

interface FileEntry {
  name: string;
  content: string;
}

async function readDir(dir: string): Promise<FileEntry[]> {
  try {
    const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
    const results: FileEntry[] = [];
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        results.push(...await readDir(rel));
      } else if (entry.name.endsWith('.ts')) {
        results.push({ name: rel, content: await readFile(join(ROOT, rel), 'utf-8') });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function readAllFiles(): Promise<FileEntry[]> {
  const groups = await Promise.all(dirsToScan().map(readDir));
  return groups.flat();
}

function buildFocusedContext(all: FileEntry[], relevant: Set<string>): string {
  if (all.length === 0) return 'No existing TypeScript files found.';

  const full = all.filter((f) => relevant.has(f.name));
  const stub = all.filter((f) => !relevant.has(f.name));

  const parts: string[] = [];
  if (stub.length > 0) {
    parts.push(
      '### Other project files (content omitted — filenames shown so you know what exists)',
      stub.map((f) => `  - ${f.name}`).join('\n'),
    );
  }
  for (const f of full) {
    parts.push(`### ${f.name}\n\`\`\`typescript\n${f.content}\n\`\`\``);
  }
  return parts.join('\n\n');
}

export async function readProjectContext(): Promise<string> {
  const all = await readAllFiles();
  if (all.length === 0) return 'No existing TypeScript files found.';
  return all.map((f) => `### ${f.name}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n');
}

/**
 * Context for investigate-fix: full content for files mentioned in the failure
 * output + files they import + fixtures/index.ts. Everything else: names only.
 */
export async function readFocusedContextForFailure(failureOutput: string): Promise<string> {
  const all = await readAllFiles();
  const contentMap = new Map(all.map((f) => [f.name, f.content]));

  const relevant = new Set<string>();

  // Collect paths mentioned directly in the failure output / stack traces
  const pathRe = /\b((?:tests|pages|fixtures|utils)\/[^\s:,'"]+\.ts)/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(failureOutput)) !== null) relevant.add(m[1]);

  // Expand: resolve imports from those files so their POMs are included too
  for (const p of [...relevant]) {
    const content = contentMap.get(p) ?? '';
    const importRe = /from\s+['"]\.\.?\/((?:pages|fixtures|utils)\/[^'"]+?)(?:\.js)?['"]/g;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(content)) !== null) {
      relevant.add(im[1].endsWith('.ts') ? im[1] : `${im[1]}.ts`);
    }
  }

  // Always include fixtures — nearly every spec imports from here
  relevant.add(fixturesFile());

  return buildFocusedContext(all, relevant);
}

/**
 * Context for generate-test: full content for fixtures + any file whose name
 * contains a feature keyword. Everything else: names only.
 *
 * This lets Claude check what specs/POMs already exist (avoiding duplicates)
 * without paying for the full content of every unrelated test file.
 */
export async function readFocusedContextForFeature(keywords: string[]): Promise<string> {
  const all = await readAllFiles();

  const relevant = new Set<string>();
  relevant.add(fixturesFile());

  const lower = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 3);
  for (const f of all) {
    const fileName = f.name.toLowerCase();
    if (lower.some((k) => fileName.includes(k))) relevant.add(f.name);
  }

  const pomIndex = formatPomIndex(buildPomIndex(all.filter((f) => f.name.startsWith(`${pomDir()}/`))));
  const context = buildFocusedContext(all, relevant);
  return pomIndex ? `${pomIndex}\n\n${context}` : context;
}

/** Build a POM Method Index over the real pages/*.ts files on disk. */
export async function getPomIndex(): Promise<PomIndexEntry[]> {
  const all = await readAllFiles();
  return buildPomIndex(all.filter((f) => f.name.startsWith(`${pomDir()}/`)));
}

/**
 * Returns true if at least one file in pages/ already matches a feature keyword.
 * Used to decide whether to split POM and spec generation into two calls.
 */
export async function pomExistsForFeature(keywords: string[]): Promise<boolean> {
  const lower = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 3);
  try {
    const entries = await readdir(join(ROOT, pomDir()));
    const match = entries.find((f) => lower.some((k) => f.toLowerCase().includes(k)));
    if (!match) return false;
    // Locators-only POMs (from generate_pom) have no async methods — treat them
    // as "not ready" so generate_test still runs the POM step to add methods.
    const content = await readFile(join(ROOT, pomDir(), match), 'utf-8');
    return extractPomMethods(content).length > 0;
  } catch {
    return false;
  }
}

export async function listResourcesTool(): Promise<{ content: { type: 'text'; text: string }[] }> {
  const [pages, fixtures, tests] = await Promise.all([
    readDir(pomDir()),
    readDir(dirname(fixturesFile())),
    readDir('tests'),
  ]);

  const format = (files: { name: string }[]) =>
    files.length ? files.map((f) => `  - ${f.name}`).join('\n') : '  (none)';

  const text = [
    '## Existing project resources\n',
    '### Pages (POMs)',
    format(pages),
    '',
    '### Fixtures',
    format(fixtures),
    '',
    '### Tests',
    format(tests),
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}
