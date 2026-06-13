import { join } from 'path';
import { readFile } from 'fs/promises';
import * as readline from 'readline';
import { autoFixFailure } from './tools/investigate-fix.js';
import { runTests } from './tools/run-tests.js';
import { TokenBudget } from './tools/budget.js';
import { writeTestAnnotation } from './tools/annotations.js';
import { parseFailingTestsFromOutput, deriveRisk } from './tools/test-registry.js';

const ROOT = process.cwd();
// No budget cap by default — cost is tracked and displayed but never blocks completion.
// Pass --budget 0.30 to opt in to a spending limit (useful when working with a shared API key).
const DEFAULT_BUDGET_USD = Infinity;

async function ensureApiKey(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const raw = await readFile(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    const key = JSON.parse(raw)?.mcpServers?.['qa-mcp-automation']?.env?.ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch { /* not found */ }
}

const DEFAULT_MAX_ATTEMPTS = 5;

function parseArgs(argv: string[]): { pattern?: string; output?: string; budget?: number; maxAttempts?: number } {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      raw[argv[i].slice(2)] = argv[++i];
    }
  }
  return {
    pattern:     raw['pattern'],
    output:      raw['output'],
    budget:      raw['budget']       ? parseFloat(raw['budget'])       : undefined,
    maxAttempts: raw['max-attempts'] ? parseInt(raw['max-attempts'], 10) : undefined,
  };
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

  const budget = new TokenBudget(args.budget ?? DEFAULT_BUDGET_USD);

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
  let attempts = 0;
  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // Fix loop — stops at natural verdicts, user declining retry, spending cap,
  // or max attempt count (whichever comes first).
  while (true) {
    if (attempts >= maxAttempts) {
      const bar = '─'.repeat(48);
      console.log(`\n${bar}`);
      console.log(`  ⛔ Maximum attempts (${maxAttempts}) reached without a fix.`);
      console.log(`  Claude couldn't resolve this automatically — investigate manually.`);
      console.log(`  Cost: ${budget.summary}`);
      console.log(`${bar}`);
      if (args.pattern) {
        console.log('\n⚠️  Writing BROKEN comment into the spec file...');
        await writeTestAnnotation(args.pattern, lastFailureOutput, 'broken', lastRootCause || `Could not auto-fix after ${maxAttempts} attempts`);
        console.log(`  Done. Open ${args.pattern} to review.\n`);
      }
      break;
    }
    if (budget.exceeded) {
      const bar = '─'.repeat(48);
      console.log(`\n${bar}`);
      console.log(`  ⚠️  Spending cap of $${budget.limitUsd.toFixed(2)} reached (${budget.summary}).`);
      console.log(`${bar}`);
      if (args.pattern) {
        console.log('\n⚠️  Writing BROKEN comment into the spec file...');
        await writeTestAnnotation(args.pattern, lastFailureOutput, 'broken', lastRootCause || 'Spending cap reached — run npm run fix to continue');
        console.log(`  Done. Open ${args.pattern} to review.\n`);
      }
      break;
    }

    attempts++;
    console.log(`\n⏳ Investigating and fixing (attempt ${attempts}/${maxAttempts})...\n`);
    const fix = await autoFixFailure(lastFailureOutput, args.pattern, budget);
    lastRootCause = fix.rootCause;

    const bar = '─'.repeat(48);
    console.log(`\n${bar}`);

    if (fix.verdict === 'transient') {
      console.log('  Verdict: ⚡ Transient infrastructure failure');
      console.log(`\n  ${fix.rootCause}`);
      console.log(`\n  Budget used: ${budget.summary}`);
      console.log(`${bar}`);
      break;
    }

    if (fix.verdict === 'flaky') {
      console.log('  Verdict: 🌀 Flaky test');
      console.log(`\n  ${fix.rootCause}`);
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
    if (fix.blockedWrites.length > 0) {
      console.log('\n  ⛔ Blocked writes — proposed fix would shrink or drop tests, needs human review:');
      for (const b of fix.blockedWrites) {
        console.log(`    ~ ${b.path}: ${b.reason}`);
        console.log(b.diff.trimEnd().split('\n').map(l => `      ${l}`).join('\n'));
      }
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
