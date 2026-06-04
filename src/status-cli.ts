import { WORKSPACE_PATHS } from './workspace.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import {
  readTestCases,
  readBrokenTests,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  TESTS_VISUAL_PATH,
} from './tools/test-registry.js';

const ROOT = process.cwd();

// ── Helpers ────────────────────────────────────────────────────────────────────

async function countSpecsInDir(dir: string): Promise<number> {
  try {
    const entries = await readdir(join(ROOT, 'tests', dir), { withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith('.spec.ts')).length;
  } catch { return 0; }
}

async function lastModifiedLabel(filePath: string): Promise<string> {
  try {
    const s = await stat(filePath);
    return s.mtime.toISOString().slice(0, 16).replace('T', ' ');
  } catch { return 'never'; }
}

/** Count how many tests in the registry actually have a [UI/API/E2E #N] tag in their spec file. */
async function countTaggedInSpecs(specs: Set<string>, prefix: string): Promise<{ tagged: number; total: number }> {
  let tagged = 0;
  let total = 0;
  for (const specPath of specs) {
    const abs = join(ROOT, specPath);
    try {
      const src = await readFile(abs, 'utf-8');
      const testMatches = src.match(/^\s*test\s*\(/gm) ?? [];
      const tagMatches = src.match(new RegExp(`\\/\\/\\s*\\[${prefix}[\\s\\w:#-]*#\\d+\\]`, 'gm')) ?? [];
      total += testMatches.length;
      tagged += tagMatches.length;
    } catch { /* spec missing */ }
  }
  return { tagged, total };
}

interface BacklogScope {
  scope: string;
  open: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

async function readBacklogStatus(): Promise<{ totalOpen: number; scopes: BacklogScope[] }> {
  const BACKLOG_PATH = WORKSPACE_PATHS.gapsBacklog;
  try {
    const content = await readFile(BACKLOG_PATH, 'utf-8');
    const lines = content.split('\n');

    let currentScope = '';
    const scopes = new Map<string, BacklogScope>();

    for (const line of lines) {
      // Section header: ## DATE — TOOL — SCOPE (N gaps)
      const headerMatch = line.match(/^## [^\n]+ — [^\n]+ — (.+?) \(\d+ gap/);
      if (headerMatch) {
        currentScope = headerMatch[1].trim();
        if (!scopes.has(currentScope)) {
          scopes.set(currentScope, { scope: currentScope, open: 0, critical: 0, high: 0, medium: 0, low: 0 });
        }
        continue;
      }

      if (!currentScope || !line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 2) continue;
      const [priority, testName] = cells;
      if (!testName || priority === 'Priority' || /^[-: ]+$/.test(priority)) continue;
      if (priority.includes('✅') || testName.includes('~~')) continue; // resolved

      const scope = scopes.get(currentScope)!;
      scope.open++;
      const p = priority.trim().toLowerCase();
      if (p === 'critical') scope.critical++;
      else if (p === 'high') scope.high++;
      else if (p === 'medium') scope.medium++;
      else scope.low++;
    }

    const result = [...scopes.values()];
    return { totalOpen: result.reduce((n, s) => n + s.open, 0), scopes: result };
  } catch {
    return { totalOpen: 0, scopes: [] };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const bar = '─'.repeat(50);
  console.log(`\n📊 QA Suite Status\n${bar}\n`);

  // ── Registries ───────────────────────────────────────────────────────────────
  const registries = [
    { path: TESTS_UI_PATH,     label: 'TESTS_UI.md    ', prefix: 'UI'     },
    { path: TESTS_API_PATH,    label: 'TESTS_API.md   ', prefix: 'API'    },
    { path: TESTS_E2E_PATH,    label: 'TESTS_E2E.md   ', prefix: 'E2E'    },
    { path: TESTS_VISUAL_PATH, label: 'TESTS_VISUAL.md', prefix: 'Visual' },
  ];

  let grandPassing = 0, grandBroken = 0, grandBugs = 0;
  const taggedStats: Array<{ prefix: string; tagged: number; total: number }> = [];

  console.log('  Registries:');
  for (const { path, label, prefix } of registries) {
    const [passing, broken, lastMod] = await Promise.all([
      readTestCases(path),
      readBrokenTests(path),
      lastModifiedLabel(path),
    ]);
    const bugs = broken.filter(e => e.kind === 'app_bug').length;
    const brokenOnly = broken.filter(e => e.kind === 'broken').length;
    grandPassing += passing.length;
    grandBroken  += brokenOnly;
    grandBugs    += bugs;

    const passingStr  = `${passing.length} passing`.padEnd(12);
    const brokenStr   = `${brokenOnly} broken`.padEnd(10);
    const bugsStr     = `${bugs} app bug${bugs !== 1 ? 's' : ''}`.padEnd(12);
    console.log(`    ${label}  ${passingStr}  ${brokenStr}  ${bugsStr}  (updated: ${lastMod})`);

    // Collect spec paths for tagging check
    const specPaths = new Set(passing.map(e => e.spec));
    const { tagged, total } = await countTaggedInSpecs(specPaths, prefix);
    taggedStats.push({ prefix, tagged, total });
  }

  console.log(`    ${'─'.repeat(46)}`);
  const totPassing = `${grandPassing} passing`.padEnd(12);
  const totBroken  = `${grandBroken} broken`.padEnd(10);
  const totBugs    = `${grandBugs} app bug${grandBugs !== 1 ? 's' : ''}`;
  console.log(`    Total         ${totPassing}  ${totBroken}  ${totBugs}`);

  // ── Tagging ──────────────────────────────────────────────────────────────────
  const totTagged = taggedStats.reduce((n, s) => n + s.tagged, 0);
  const totTaggable = taggedStats.reduce((n, s) => n + s.total, 0);
  const tagIcon = totTagged === totTaggable ? '✅' : '⚠️ ';
  console.log(`\n  ${tagIcon} Spec tagging: ${totTagged}/${totTaggable} tests tagged`);
  if (totTagged < totTaggable) {
    console.log('     Run: npm run tag_tests');
  }

  // ── Gaps Backlog ─────────────────────────────────────────────────────────────
  const { totalOpen, scopes } = await readBacklogStatus();
  if (totalOpen === 0) {
    console.log('\n  📋 Gaps Backlog: empty (no open gaps)\n');
  } else {
    console.log(`\n  📋 Gaps Backlog: ${totalOpen} open gap${totalOpen !== 1 ? 's' : ''}`);
    for (const [i, s] of scopes.filter(s => s.open > 0).entries()) {
      const connector = i === scopes.filter(s => s.open > 0).length - 1 ? '└' : '├';
      const tiers = [
        s.critical > 0 ? `${s.critical} critical` : '',
        s.high     > 0 ? `${s.high} high`     : '',
        s.medium   > 0 ? `${s.medium} medium`  : '',
        s.low      > 0 ? `${s.low} low`        : '',
      ].filter(Boolean).join('  ');
      console.log(`     ${connector} ${s.scope}  —  ${tiers}`);
    }
    console.log('     Run: npm run analyze_coverage -- --gaps  (to refresh)');
  }

  // ── Spec files on disk ───────────────────────────────────────────────────────
  const [uiCount, e2eCount, apiCount, visualCount] = await Promise.all([
    countSpecsInDir('ui'),
    countSpecsInDir('e2e'),
    countSpecsInDir('api'),
    countSpecsInDir('visual'),
  ]);
  console.log(`\n  📁 Spec files:  ui/ ${uiCount}  ·  e2e/ ${e2eCount}  ·  api/ ${apiCount}  ·  visual/ ${visualCount}\n`);

  console.log(bar + '\n');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
