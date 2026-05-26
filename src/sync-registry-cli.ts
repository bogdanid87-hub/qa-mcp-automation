import { runTests } from './tools/run-tests.js';
import {
  readTestCases,
  readBrokenTests,
  recordPassingTests,
  removeResolvedBrokenTests,
  parsePassingTests,
  parseFailingTestsFromOutput,
  demoteTobroken,
} from './tools/test-registry.js';

async function main(): Promise<void> {
  console.log('\n⏳ Running full test suite...\n');
  const output = await runTests();

  const passingResults = parsePassingTests(output);
  const failingResults = parseFailingTestsFromOutput(output);

  const totalRan = passingResults.length + failingResults.length;
  console.log(`▶ ${passingResults.length} passed, ${failingResults.length} failed (${totalRan} total)\n`);

  if (totalRan === 0) {
    console.log('⚠️  No tests found — check that the test suite runs correctly.\n');
    return;
  }

  const recordedPassing = await readTestCases();
  const recordedBroken = await readBrokenTests();

  const passingKeys = new Set(recordedPassing.map(e => `${e.spec}::${e.name}`));
  const brokenKeys = new Set(recordedBroken.map(e => `${e.spec}::${e.name}`));

  const passingResultKeys = new Set(
    passingResults.map(p => {
      const sep = p.title.indexOf(' › ');
      return sep === -1
        ? `${p.spec}::${p.title}`
        : `${p.spec}::${p.title.substring(sep + 3)}`;
    }),
  );

  // ── 1. Undocumented passing tests ─────────────────────────────────────────
  const toAdd = passingResults.filter(p => {
    const sep = p.title.indexOf(' › ');
    const name = sep === -1 ? p.title : p.title.substring(sep + 3);
    const key = `${p.spec}::${name}`;
    return !passingKeys.has(key) && !brokenKeys.has(key);
  });

  // ── 2. Broken/app-bug tests that now pass → promote ───────────────────────
  const toPromote = recordedBroken.filter(e => passingResultKeys.has(`${e.spec}::${e.name}`));

  // ── 3. Previously-passing tests that are now failing → regression ─────────
  const toFlag = failingResults.filter(f => {
    const key = `${f.spec}::${f.name}`;
    return passingKeys.has(key) && !brokenKeys.has(key);
  });

  let changed = 0;

  if (toAdd.length > 0) {
    console.log(`📝 Adding ${toAdd.length} undocumented passing test(s):`);
    for (const t of toAdd) {
      const sep = t.title.indexOf(' › ');
      const name = sep === -1 ? t.title : t.title.substring(sep + 3);
      console.log(`   + ${t.spec} › ${name}`);
    }
    await recordPassingTests(toAdd);
    changed += toAdd.length;
    console.log('');
  }

  if (toPromote.length > 0) {
    console.log(`✅ Promoting ${toPromote.length} resolved broken/app-bug test(s):`);
    const promotedAsPassingTests = toPromote.map(e => ({ spec: e.spec, title: `${e.describe} › ${e.name}` }));
    await recordPassingTests(promotedAsPassingTests);
    await removeResolvedBrokenTests(new Set(toPromote.map(e => `${e.spec}::${e.name}`)));
    for (const e of toPromote) {
      const label = e.kind === 'app_bug' ? '⚠️  App bug resolved' : '❌ Broken test resolved';
      console.log(`   ✅ ${label}: ${e.spec} › ${e.name}`);
    }
    changed += toPromote.length;
    console.log('');
  }

  if (toFlag.length > 0) {
    console.log(`⚠️  Flagging ${toFlag.length} regression(s) as broken:`);
    await demoteTobroken(
      toFlag.map(f => ({
        ...f,
        kind: 'broken' as const,
        rootCause: 'Regression — was passing but is now failing. Run `npm run fix` to investigate.',
      })),
    );
    for (const f of toFlag) {
      console.log(`   ❌ Regression: ${f.spec} › ${f.name}`);
    }
    changed += toFlag.length;
    console.log('\n   ⚠️  BROKEN comments were NOT added to spec files — run `npm run fix -- --pattern <spec>` for each.\n');
  }

  if (changed === 0) {
    console.log('✅ TEST_CASES.md is already in sync — nothing to update.\n');
  } else {
    console.log(`✅ TEST_CASES.md updated (${changed} change${changed === 1 ? '' : 's'}).\n`);
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
