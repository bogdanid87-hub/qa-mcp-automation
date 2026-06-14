import { access, mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { safeWrite } from '../lib/safe-write.js';
import { validate, type MqaConfig } from '../config.js';
import { BASE_PAGE_TEMPLATE, FIXTURES_INDEX_TEMPLATE, LEARNED_RULES_TEMPLATE, SITE_PAGE_TEMPLATE } from './init-project-templates.js';

export type RiskTiers = MqaConfig['riskTiers'];

/**
 * Starting riskTiers keyword sets. There's no universal vocabulary, so callers
 * pick a profile and may still override individual tiers on top of it.
 */
export const PROFILE_RISK_TIERS: Record<'generic' | 'ecommerce', RiskTiers> = {
  generic: {
    critical: ['delete', 'remove', 'cancel', 'payment', 'checkout', 'purchase', 'transfer', 'refund'],
    high:     ['auth', 'login', 'logout', 'signup', 'register', 'password', 'account', 'session', 'permission', 'role'],
    medium:   ['search', 'filter', 'sort', 'create', 'update', 'edit', 'form', 'upload', 'settings'],
    low:      ['contact', 'about', 'faq', 'static', 'footer', 'help', 'terms', 'privacy'],
  },
  ecommerce: {
    critical: ['checkout', 'payment', 'order', 'cart'],
    high:     ['auth', 'login', 'register', 'account', 'profile'],
    medium:   ['search', 'filter', 'product', 'listing', 'detail'],
    low:      ['contact', 'newsletter', 'subscription', 'static'],
  },
};

export interface InitProjectArgs {
  projectName: string;
  siteUrl: string;
  profile?: 'generic' | 'ecommerce';
  riskTiers?: Partial<RiskTiers>;
  outputPath?: string;
  force?: boolean;
}

/** Build the mcp-qa.config.json contents for a new project. Pure — no I/O. */
export function buildMqaConfig(args: InitProjectArgs): MqaConfig {
  const base = PROFILE_RISK_TIERS[args.profile ?? 'generic'];

  return {
    project: {
      name: args.projectName,
      siteUrl: args.siteUrl,
    },
    testing: {
      folders: {
        ui: 'tests/ui',
        api: 'tests/api',
        e2e: 'tests/e2e',
        visual: 'tests/visual',
      },
      registries: {
        ui: 'TESTS_UI.md',
        api: 'TESTS_API.md',
        e2e: 'TESTS_E2E.md',
        visual: 'TESTS_VISUAL.md',
      },
    },
    riskTiers: {
      critical: args.riskTiers?.critical ?? base.critical,
      high:     args.riskTiers?.high ?? base.high,
      medium:   args.riskTiers?.medium ?? base.medium,
      low:      args.riskTiers?.low ?? base.low,
    },
    pom: {
      baseClass: 'BasePage',
      siteClass: 'SitePage',
      siteClassProvides: [],
      intermediateClasses: [],
    },
    models: {
      primary: 'claude-sonnet-4-6',
      local: 'qwen2.5-coder:14b',
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface ScaffoldEntry {
  /** Path relative to the project root, e.g. "pages/SitePage.ts". */
  relPath: string;
  created: boolean;
}

/**
 * Lay down the directory/file skeleton implied by `config` — create-if-missing
 * only, never overwrite. Independent of the config file's `force` flag.
 */
async function scaffoldProject(root: string, config: MqaConfig): Promise<ScaffoldEntry[]> {
  const targets: Array<{ relPath: string; content: string }> = [
    ...Object.values(config.testing.folders).map((folder) => ({ relPath: `${folder}/.gitkeep`, content: '' })),
    { relPath: 'test-data/.gitkeep', content: '' },
    { relPath: 'pages/BasePage.ts', content: BASE_PAGE_TEMPLATE },
    { relPath: 'pages/SitePage.ts', content: SITE_PAGE_TEMPLATE },
    { relPath: 'fixtures/index.ts', content: FIXTURES_INDEX_TEMPLATE },
    { relPath: 'learned-rules.md', content: LEARNED_RULES_TEMPLATE },
  ];

  const entries: ScaffoldEntry[] = [];
  for (const { relPath, content } of targets) {
    const absPath = join(root, relPath);
    if (await fileExists(absPath)) {
      entries.push({ relPath, created: false });
      continue;
    }
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf-8');
    entries.push({ relPath, created: true });
  }
  return entries;
}

function errorResult(message: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: `❌ ${message}` }] };
}

/**
 * Bootstrap mcp-qa.config.json plus the minimal pages/fixtures/tests scaffold
 * for a new project. Writes no files outside outputPath's directory tree; never
 * runs audit_site or calls an LLM.
 */
export async function initProjectTool(args: InitProjectArgs): Promise<{ content: { type: 'text'; text: string }[] }> {
  if (!args.projectName.trim()) {
    return errorResult('projectName is required.');
  }

  try {
    new URL(args.siteUrl);
  } catch {
    return errorResult(`"${args.siteUrl}" is not a valid URL — siteUrl must be a full URL like "https://example.com".`);
  }

  const outputPath = args.outputPath ?? join(process.cwd(), 'mcp-qa.config.json');
  const root = dirname(outputPath);

  if (await fileExists(outputPath) && !args.force) {
    return errorResult(
      `${outputPath} already exists. Pass force: true to overwrite, or edit it directly if you're ` +
      `customizing an existing project's config.`,
    );
  }

  let config: MqaConfig;
  try {
    config = buildMqaConfig(args);
    validate(config);
  } catch (err) {
    return errorResult(`Could not build a valid config: ${(err as Error).message}`);
  }

  const json = JSON.stringify(config, null, 2) + '\n';
  const writeResult = await safeWrite(outputPath, json, { allowOverwrite: !!args.force });
  if (!writeResult.ok) {
    return errorResult(`Failed to write ${outputPath}: ${writeResult.reason}`);
  }

  const scaffold = await scaffoldProject(root, config);

  const lines: string[] = [
    writeResult.written
      ? `✅ Wrote ${outputPath}`
      : `✅ ${outputPath} already up to date`,
    '',
    'Scaffold:',
    ...scaffold.map((e) => `  ${e.created ? '✅ created' : '⏭️  skipped (already exists)'}  ${e.relPath}`),
    '',
    'Next steps:',
    `  1. Run \`npm run audit_site -- --url ${args.siteUrl}\` to discover the site's page structure.`,
    '  2. Use the audit report to fill in pom.intermediateClasses, pom.siteClassProvides, and riskTiers in mcp-qa.config.json.',
    '  3. Run generate_pom against your homepage/login page to populate pages/SitePage.ts with real locators.',
    '  4. Run generate_test for your first test.',
  ];

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
