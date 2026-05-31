import { join } from 'path';
import { readFile } from 'fs/promises';
import * as readline from 'readline';
import { autoFixFailure } from './tools/investigate-fix.js';
import { runTests } from './tools/run-tests.js';
import { TokenBudget } from './tools/budget.js';
import { writeTestAnnotation } from './tools/annotations.js';
import { parseFailingTestsFromOutput, deriveRisk } from './tools/test-registry.js';

const ROOT = process.cwd();
const DEFAULT_BUDGET_USD = 0.30;

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

function parseArgs(argv: string[]): { pattern?: string; output?: string } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return { pattern: raw['pattern'], output: raw['output'] };
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function askYesNo(question: string): Promise<boolean> {
  return (await ask(question)).toLowerCase() === 'y';
}


async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await ensureApiKey();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nError: ANTHROPIC_API_KEY is not set.\n');
    process.exit(1);
  }

  const budget = new TokenBudget(DEFAULT_BUDGET_USD);

  // Get initial failure output
  let failureOutput = args.output ?? '';
  if (!failureOutput) {
    const label = args.pattern ? `tests matching "${args.pattern}"` : 'all tests';
    console.log(`\n▶ Running ${label}...\n`);
    failureOutput = await runTests(args.pattern);
    console.log(failureOutput);
  }

  if (!failureOutput.includes('failed') && !failureOutput.includes('Error')) {
    console.log('\n✅ No failures detected — nothing to fix.\n');
    process.exit(0);
  }

  // ── Triage: show failing tests sorted by risk before spending any tokens ───
  const failing = parseFailingTestsFromOutput(failureOutput);
  if (failing.length > 0) {
    const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const withRisk = failing
      .map(f => ({ ...f, risk: deriveRisk(f.spec, f.describe) }))
      .sort((a, b) => (RISK_ORDER[a.risk] ?? 3) - (RISK_ORDER[b.risk] ?? 3));

    const bar = '─'.repeat(48);
    console.log(`\n${bar}`);
    console.log(`  ${failing.length} test${failing.length === 1 ? '' : 's'} failing — by priority:`);
    console.log('');
    for (const f of withRisk) {
      console.log(`  ${f.risk.padEnd(8)}  ${f.spec} › ${f.name}`);
    }
    console.log(`${bar}\n`);
  }

  let lastRootCause = '';
  let lastFailureOutput = failureOutput;

  // Fix loop
  while (true) {
    if (budget.exceeded) {
      const bar = '─'.repeat(48);
      console.log(`\n${bar}`);
      console.log(`  ⚠️  Token budget of $${budget.limitUsd.toFixed(2)} reached (${budget.summary}).`);
      console.log(`${bar}`);
      const continueAnyway = await askYesNo('Continue spending tokens anyway? [y/N] ');
      if (!continueAnyway) {
        if (args.pattern) {
          console.log('\n⚠️  Writing BROKEN comment into the spec file...');
          await writeTestAnnotation(args.pattern, lastFailureOutput, 'broken', lastRootCause || 'Exceeded token budget during auto-fix');
          console.log(`  Done. Open ${args.pattern} to review.\n`);
        }
        break;
      }
    }

    console.log('\n⏳ Investigating and fixing...\n');
    const fix = await autoFixFailure(lastFailureOutput, args.pattern, budget);
    lastRootCause = fix.rootCause;

    const bar = '─'.repeat(48);
    console.log(`\n${bar}`);

    if (fix.verdict === 'flaky') {
      console.log('  Verdict: 🌀 Flaky / transient failure');
      console.log(`\n  ${fix.rootCause}`);
      console.log(`\n  The test was NOT modified. Re-run to confirm or add retries to playwright.config.ts.`);
      console.log(`\n  Budget used: ${budget.summary}`);
      console.log(`${bar}`);
      break;
    }

    if (fix.verdict === 'app_bug') {
      console.log('  Verdict: ⚠️  Application bug');
      console.log(`\n  The test is correct — the application has a defect.`);
      console.log(`  Expected: ${fix.rootCause}`);
      console.log(`  Actual:   ${fix.actualBehavior ?? '(see failure output)'}`);
      console.log(`\n  Budget used: ${budget.summary}`);
      console.log(`${bar}`);
      if (args.pattern) {
        console.log('\n  Writing APP BUG annotation into the spec file...');
        await writeTestAnnotation(args.pattern, lastFailureOutput, 'app_bug', fix.rootCause, fix.actualBehavior);
        console.log(`  Done. The test was NOT modified — it documents a real defect.\n`);
      }
      break;
    }

    console.log(`  Verdict: ${fix.verdict === 'code_bug' ? '🔧 Code bug' : '❓ Unclear'}`);
    console.log(`\n  Root cause:\n  ${fix.rootCause}`);
    if (fix.fixedFiles.length > 0) {
      console.log('\n  Fixed files:');
      for (const f of fix.fixedFiles) console.log(`    ~ ${f}`);
    } else {
      console.log('\n  No files were changed.');
    }
    if (fix.lesson) {
      console.log(`\n  Lesson learned (added to rules):\n    ${fix.lesson.rule}`);
    }
    console.log(`\n  Budget used: ${budget.summary}`);
    console.log(`${bar}`);

    if (fix.fixed) {
      const passed = (fix.verifyOutput.match(/✓/g) ?? []).length;
      console.log(`\n✅ Fixed — ${passed} test${passed === 1 ? '' : 's'} now passing — recorded in the registry\n`);
      break;
    }

    lastFailureOutput = fix.verifyOutput || lastFailureOutput;
    console.log('\n❌ Still failing after fix attempt.');

    const retry = await askYesNo('Attempt another fix? [y/N] ');
    if (!retry) {
      if (args.pattern) {
        console.log('\n⚠️  Writing BROKEN comment into the spec file...');
        await writeTestAnnotation(args.pattern, lastFailureOutput, 'broken', lastRootCause);
        console.log(`  Done. Open ${args.pattern} to review.\n`);
      }
      break;
    }
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
