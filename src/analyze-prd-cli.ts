import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { analyzePrdTool, type PrdFile } from './tools/analyze-prd.js';

const ROOT = process.cwd();

const IMAGE_TYPES: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

async function loadAsPrdFile(filePath: string): Promise<PrdFile> {
  const buf = await readFile(filePath);
  return { data: buf.toString('base64'), mediaType: 'application/pdf' };
}

async function loadAsImage(filePath: string): Promise<PrdFile> {
  const ext = extname(filePath).toLowerCase();
  const buf = await readFile(filePath);
  return { data: buf.toString('base64'), mediaType: IMAGE_TYPES[ext] ?? 'image/png' };
}

async function main(): Promise<void> {
  await ensureApiKey();

  const raw: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--') && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
      raw[process.argv[i].slice(2)] = process.argv[++i];
    }
  }

  const filePath = raw['file'];
  if (!filePath) {
    console.error(
      '\nUsage:\n' +
      '  npm run analyze-prd -- --file prd.md\n' +
      '  npm run analyze-prd -- --file spec.pdf\n' +
      '  npm run analyze-prd -- --file wireframe.png\n' +
      '  npm run analyze-prd -- --file prd.md --images wireframe.png,mockup.jpg\n' +
      '  npm run analyze-prd -- --file prd.md --output sprint-tests.txt\n' +
      '  npm run analyze-prd -- --file prd.md --tier critical,high\n' +
      '  npm run analyze-prd -- --file prd.md --focus checkout,authentication\n' +
      '\nSupported formats:\n' +
      '  Text/Markdown  (.md .txt)     — read as plain text\n' +
      '  PDF            (.pdf)         — passed to Claude natively (preserves layout)\n' +
      '  Images         (.png .jpg .jpeg .gif .webp) — Claude reads wireframes/mockups\n' +
      '  PowerPoint/Excel/Word         — export to PDF first, then use --file spec.pdf\n',
    );
    process.exit(1);
  }

  const ext = extname(filePath).toLowerCase();
  const isImage = ext in IMAGE_TYPES;
  const isPdf = ext === '.pdf';
  const isText = !isImage && !isPdf;

  // Load main file
  let prdContent: string | undefined;
  let prdFile: PrdFile | undefined;
  let primaryLabel: string;

  try {
    if (isText) {
      prdContent = await readFile(filePath, 'utf-8');
      primaryLabel = `${filePath} (text)`;
    } else if (isPdf) {
      prdFile = await loadAsPrdFile(filePath);
      primaryLabel = `${filePath} (PDF)`;
    } else {
      // Single image passed as the main file
      prdFile = await loadAsImage(filePath);
      prdFile.mediaType = IMAGE_TYPES[ext];
      primaryLabel = `${filePath} (image)`;
    }
  } catch (err: any) {
    console.error(`\nCould not read ${filePath}: ${err.message}\n`);
    process.exit(1);
  }

  // Load supplementary images (--images flag, comma-separated)
  const images: PrdFile[] = [];
  if (raw['images']) {
    for (const imgPath of raw['images'].split(',').map(s => s.trim()).filter(Boolean)) {
      try {
        images.push(await loadAsImage(imgPath));
        console.log(`  + image: ${imgPath}`);
      } catch (err: any) {
        console.warn(`  ⚠️  Could not load image ${imgPath}: ${err.message}`);
      }
    }
  }

  const tier = raw['tier']?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const focus = raw['focus']?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const inputDesc = [primaryLabel, ...images.map((_: PrdFile, i: number) => raw['images']?.split(',')[i]?.trim())].filter(Boolean).join(' + ');
  const filterDesc = [
    ...(tier?.length ? [`tier: ${tier.join(', ')}`] : []),
    ...(focus?.length ? [`focus: ${focus.join(', ')}`] : []),
  ].join(' | ');
  console.log(`\n⏳ Analysing PRD (${inputDesc}${filterDesc ? ` — ${filterDesc}` : ''})...\n`);

  const result = await analyzePrdTool({
    prdContent,
    prdFile: isPdf || isImage ? prdFile : undefined,
    images: images.length > 0 ? images : undefined,
    outputFile: raw['output'] ? join(ROOT, raw['output']) : undefined,
    tier: tier?.length ? tier : undefined,
    focus: focus?.length ? focus : undefined,
  });

  console.log(result.content[0]?.text ?? '');
  console.log('');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
