import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const ROOT = process.cwd();

async function readDir(dir: string): Promise<{ name: string; content: string }[]> {
  try {
    const entries = await readdir(join(ROOT, dir));
    const files = await Promise.all(
      entries
        .filter((f) => f.endsWith('.ts'))
        .map(async (f) => ({
          name: `${dir}/${f}`,
          content: await readFile(join(ROOT, dir, f), 'utf-8'),
        })),
    );
    return files;
  } catch {
    return [];
  }
}

export async function readProjectContext(): Promise<string> {
  const [pages, fixtures, tests, utils] = await Promise.all([
    readDir('pages'),
    readDir('fixtures'),
    readDir('tests'),
    readDir('utils'),
  ]);

  const all = [...pages, ...fixtures, ...tests, ...utils];
  if (all.length === 0) return 'No existing TypeScript files found.';

  return all.map((f) => `### ${f.name}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n');
}

export async function listResourcesTool(): Promise<{ content: { type: 'text'; text: string }[] }> {
  const [pages, fixtures, tests] = await Promise.all([
    readDir('pages'),
    readDir('fixtures'),
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
