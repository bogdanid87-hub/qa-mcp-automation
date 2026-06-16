import { readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { chromium } from '@playwright/test';
import { analyzePrdTool, type PrdFile } from './tools/analyze-prd.js';
import { WORKSPACE_PATHS, ensureWorkspace, PRD_TEMPLATE } from './workspace.js';

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

/**
 * Navigate to a URL headlessly and return the page's rendered text content.
 * Uses Playwright so JS-rendered pages are handled correctly.
 */
async function fetchUrlAsText(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const ads = ['googlesyndication', 'doubleclick', 'googleads', 'adsbygoogle'];
      if (ads.some(f => route.request().url().includes(f))) route.abort();
      else route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const text = await page.evaluate(() => document.body.innerText);
    return text.trim();
  } finally {
    await browser.close();
  }
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

  const pageUrl = raw['url'];
  // Default to workspace/prd.md; auto-create with template if missing
  let filePath = raw['file'];
  if (!filePath && !pageUrl) {
    await ensureWorkspace();
    const defaultPath = WORKSPACE_PATHS.prd;
    try {
      await readFile(defaultPath);
      filePath = defaultPath;
    } catch {
      await writeFile(defaultPath, PRD_TEMPLATE, 'utf-8');
      console.log('\n📝 Created workspace/prd.md — fill it in and re-run.\n');
      process.exit(0);
    }
  }

  if (!filePath && !pageUrl) {
    console.error(
      '\nUsage:\n' +
      '  npm run analyze_prd -- --file prd.md\n' +
      '  npm run analyze_prd -- --file spec.pdf\n' +
      '  npm run analyze_prd -- --file wireframe.png\n' +
      '  npm run analyze_prd -- --file tests/ui/cart.spec.ts\n' +
      '  npm run analyze_prd -- --url https://example.com/api-docs\n' +
      '  npm run analyze_prd -- --file prd.md --images wireframe.png,mockup.jpg\n' +
      '  npm run analyze_prd -- --file prd.md --output sprint-tests.txt\n' +
      '  npm run analyze_prd -- --file prd.md --tier critical,high\n' +
      '  npm run analyze_prd -- --file prd.md --focus checkout,authentication\n' +
      '\nSupported inputs:\n' +
      '  --file prd.md              Text/Markdown — read as plain text\n' +
      '  --file spec.pdf            PDF — passed to Claude natively (preserves layout)\n' +
      '  --file wireframe.png       Image (.png .jpg .jpeg .gif .webp) — Claude reads visuals\n' +
      '  --file tests/ui/*.spec.ts  Existing spec — extracts test names, suggests what\'s missing\n' +
      '  --url https://...          Web page — rendered text extracted via headless browser\n' +
      '  PowerPoint/Excel/Word      Export to PDF first, then use --file spec.pdf\n',
    );
    process.exit(1);
  }

  if (filePath && pageUrl) {
    console.error('\nError: provide either --file or --url, not both.\n');
    process.exit(1);
  }

  // Load main input
  let prdContent: string | undefined;
  let prdFile: PrdFile | undefined;
  let specPath: string | undefined;
  let primaryLabel: string;

  if (pageUrl) {
    // Fetch a live web page — API docs, feature specs, wikis, etc.
    try {
      console.log(`\n  Fetching ${pageUrl}...`);
      prdContent = await fetchUrlAsText(pageUrl);
      primaryLabel = pageUrl;
    } catch (err: any) {
      console.error(`\nCould not fetch ${pageUrl}: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    const ext = extname(filePath!).toLowerCase();
    const isSpec = filePath!.endsWith('.spec.ts');
    const isImage = !isSpec && ext in IMAGE_TYPES;
    const isPdf = !isSpec && ext === '.pdf';
    const isText = !isSpec && !isImage && !isPdf;

    try {
      if (isSpec) {
        specPath = filePath!;
        primaryLabel = `${filePath} (spec)`;
      } else if (isText) {
        prdContent = await readFile(filePath!, 'utf-8');
        primaryLabel = `${filePath} (text)`;
      } else if (isPdf) {
        prdFile = await loadAsPrdFile(filePath!);
        primaryLabel = `${filePath} (PDF)`;
      } else {
        prdFile = await loadAsImage(filePath!);
        prdFile.mediaType = IMAGE_TYPES[ext];
        primaryLabel = `${filePath} (image)`;
      }
    } catch (err: any) {
      console.error(`\nCould not read ${filePath}: ${err.message}\n`);
      process.exit(1);
    }
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
    prdFile: prdFile,
    specPath,
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
