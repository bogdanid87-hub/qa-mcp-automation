import { access } from 'fs/promises';
import { join } from 'path';
import { runTests } from './tools/run-tests.js';
import {
  readTestCases,
  readBrokenTests,
  recordPassingTests,
  recordBrokenTest,
  removeResolvedBrokenTests,
  parsePassingTests,
  parseFailingTestsFromOutput,
  normalizeTestName,
  demoteTobroken,
  registryForSpec,
  TESTS_UI_PATH,
  TESTS_API_PATH,
  TESTS_E2E_PATH,
  type BrokenEntry,
  type FailingTestResult,
} from './tools/test-registry.js';
import { readAnnotationFromSpec } from './tools/annotations.js';
import { markBacklogEntriesCovered } from './tools/analyze-coverage.js';

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

  // Load both registries — the routing for writes is handled by registryForSpec()
  const [recordedPassing, recordedPassingApi, recordedPassingE2e] = await Promise.all([
    readTestCases(TESTS_UI_PATH),
    readTestCases(TESTS_API_PATH),
    readTestCases(TESTS_E2E_PATH),
  ]);
  const [recordedBroken, recordedBrokenApi, recordedBrokenE2e] = await Promise.all([
    readBrokenTests(TESTS_UI_PATH),
    readBrokenTests(TESTS_API_PATH),
    readBrokenTests(TESTS_E2E_PATH),
  ]);
  const allRecordedPassing = [...recordedPassing, ...recordedPassingApi, ...recordedPassingE2e];
  const allRecordedBroken  = [...recordedBroken,  ...recordedBrokenApi,  ...recordedBrokenE2e];

  // Warn about spec files referenced in registries that no longer exist on disk
  const ROOT = process.cwd();
  const registeredSpecs = new Set([...allRecordedPassing, ...allRecordedBroken].map(e => e.spec));
  for (const spec of registeredSpecs) {
    try { await access(join(ROOT, spec)); } catch {
      console.log(`⚠️  Orphaned registry entry: ${spec} no longer exists on disk. Run sync_registry again after deleting its entries manually.\n`);
    }
  }

  const passingKeys = new Set(allRecordedPassing.map(e => `${e.spec}::${e.name}`));
  const brokenKeys  = new Set(allRecordedBroken.map(e => `${e.spec}::${e.name}`));

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
  // Use both exact key match and normalised name match so minor wording drift
  // (e.g. "place order" vs "place an order") doesn't leave stale broken entries.
  const toPromote = allRecordedBroken.filter(e => {
    if (passingResultKeys.has(`${e.spec}::${e.name}`)) return true;
    const normBroken = normalizeTestName(e.name);
    return passingResults.some(p => {
      const sep = p.title.indexOf(' › ');
      const name = sep === -1 ? p.title : p.title.substring(sep + 3);
      return p.spec === e.spec && normalizeTestName(name) === normBroken;
    });
  });

  // ── 3. Failing tests with no entry anywhere in TEST_CASES.md ─────────────
  // These were never recorded — written manually, via Claude Code, or from an
  // interrupted MCP write that annotated the spec file but never updated the registry.
  const toAddBroken = failingResults.filter(f => {
    const key = `${f.spec}::${f.name}`;
    return !passingKeys.has(key) && !brokenKeys.has(key);
  });

  // ── 4. Previously-passing tests that are now failing → verify before flagging
  // Re-run the affected spec(s) once to rule out transient failures (high traffic,
  // network blip, etc.). Only flag as broken if the test fails both times.
  const candidateRegressions = failingResults.filter(f => {
    const key = `${f.spec}::${f.name}`;
    return passingKeys.has(key) && !brokenKeys.has(key);
  });

  const toFlag: FailingTestResult[] = [];
  const flaky: FailingTestResult[] = [];

  if (candidateRegressions.length > 0) {
    // Group candidates by spec so we run each spec file at most once
    const specsToRerun = [...new Set(candidateRegressions.map(f => f.spec))];
    console.log(`⚡ ${candidateRegressions.length} candidate regression(s) — re-running to rule out transient failures...\n`);

    const stillFailingKeys = new Set<string>();

    for (const spec of specsToRerun) {
      console.log(`   ↺  Re-running ${spec}...`);
      const retryOutput = await runTests(spec);
      const retryFailing = parseFailingTestsFromOutput(retryOutput);
      for (const f of retryFailing) {
        stillFailingKeys.add(`${f.spec}::${f.name}`);
      }
    }
    console.log('');

    for (const f of candidateRegressions) {
      if (stillFailingKeys.has(`${f.spec}::${f.name}`)) {
        toFlag.push(f);
      } else {
        flaky.push(f);
      }
    }
  }

  // ── Apply changes ──────────────────────────────────────────────────────────
  let changed = 0;

  if (toAddBroken.length > 0) {
    console.log(`⚠️  Adding ${toAddBroken.length} unrecorded failing test(s):`);
    for (const f of toAddBroken) {
      const annotation = await readAnnotationFromSpec(f.spec, f.name);
      const kind = annotation?.kind ?? 'broken';
      const label = kind === 'app_bug' ? '⚠️  APP BUG' : '❌ BROKEN';
      console.log(`   ${label}: ${f.spec} › ${f.name}`);
      await recordBrokenTest({
        ...f,
        kind,
        rootCause: annotation?.rootCause ?? 'Failing but never recorded — run `npm run fix` to investigate.',
        actualBehavior: annotation?.actualBehavior,
      }, registryForSpec(f.spec));
    }
    changed += toAddBroken.length;
    console.log('');
  }

  if (toAdd.length > 0) {
    console.log(`📝 Adding ${toAdd.length} undocumented passing test(s):`);
    for (const t of toAdd) {
      const sep = t.title.indexOf(' › ');
      const name = sep === -1 ? t.title : t.title.substring(sep + 3);
      console.log(`   + ${t.spec} › ${name}`);
    }
    // Group by registry and write to each
    const addByRegistry = new Map<string, typeof toAdd>();
    for (const t of toAdd) {
      const reg = registryForSpec(t.spec);
      if (!addByRegistry.has(reg)) addByRegistry.set(reg, []);
      addByRegistry.get(reg)!.push(t);
    }
    for (const [, tests] of addByRegistry) await recordPassingTests(tests);
    changed += toAdd.length;
    console.log('');
  }

  if (toPromote.length > 0) {
    console.log(`✅ Promoting ${toPromote.length} resolved broken/app-bug test(s):`);
    const promotedAsPassingTests = toPromote.map(e => ({ spec: e.spec, title: `${e.describe} › ${e.name}` }));
    // Route promotions to the right registry
    const promoteByRegistry = new Map<string, typeof promotedAsPassingTests>();
    for (const t of promotedAsPassingTests) {
      const reg = registryForSpec(t.spec);
      if (!promoteByRegistry.has(reg)) promoteByRegistry.set(reg, []);
      promoteByRegistry.get(reg)!.push(t);
    }
    for (const [, tests] of promoteByRegistry) await recordPassingTests(tests);
    // Remove from broken in each registry
    const promoteByBrokenRegistry = new Map<string, Set<string>>();
    for (const e of toPromote) {
      const reg = registryForSpec(e.spec);
      if (!promoteByBrokenRegistry.has(reg)) promoteByBrokenRegistry.set(reg, new Set());
      promoteByBrokenRegistry.get(reg)!.add(`${e.spec}::${e.name}`);
    }
    for (const [reg, keys] of promoteByBrokenRegistry) await removeResolvedBrokenTests(keys, reg);
    for (const e of toPromote) {
      const label = e.kind === 'app_bug' ? '⚠️  App bug resolved' : '❌ Broken test resolved';
      console.log(`   ✅ ${label}: ${e.spec} › ${e.name}`);
    }
    changed += toPromote.length;
    console.log('');
  }

  if (flaky.length > 0) {
    console.log(`⚡ ${flaky.length} test(s) passed on re-run — likely transient (high traffic / network blip), not flagged:`);
    for (const f of flaky) {
      console.log(`   ~ ${f.spec} › ${f.name}`);
    }
    console.log('');
  }

  if (toFlag.length > 0) {
    console.log(`⚠️  Flagging ${toFlag.length} confirmed regression(s) (failed twice):`);
    const flagEntries: BrokenEntry[] = await Promise.all(
      toFlag.map(async f => {
        const annotation = await readAnnotationFromSpec(f.spec, f.name);
        return {
          ...f,
          kind: annotation?.kind ?? ('broken' as const),
          rootCause: annotation?.rootCause ?? 'Regression — failed on two consecutive runs. Run `npm run fix` to investigate.',
          actualBehavior: annotation?.actualBehavior,
        };
      }),
    );
    // Route regressions to the right registry
    const demoteByRegistry = new Map<string, BrokenEntry[]>();
    for (const e of flagEntries) {
      const reg = registryForSpec(e.spec);
      if (!demoteByRegistry.has(reg)) demoteByRegistry.set(reg, []);
      demoteByRegistry.get(reg)!.push(e);
    }
    for (const [reg, entries] of demoteByRegistry) await demoteTobroken(entries, reg);
    for (const entry of flagEntries) {
      const label = entry.kind === 'app_bug' ? '⚠️  APP BUG' : '❌ Regression';
      console.log(`   ${label}: ${entry.spec} › ${entry.name}`);
    }
    changed += toFlag.length;
    console.log('\n   ⚠️  BROKEN comments were NOT added to spec files — run `npm run fix -- --pattern <spec>` for each.\n');
  }

  // Auto-close matching GAPS_BACKLOG.md entries for tests that are now passing
  if (toAdd.length > 0 || toPromote.length > 0) {
    const nowPassing = [
      ...toAdd.map(t => { const s = t.title.indexOf(' › '); return s === -1 ? t.title : t.title.substring(s + 3); }),
      ...toPromote.map(e => e.name),
    ];
    const backlogClosed = await markBacklogEntriesCovered(nowPassing).catch(() => 0);
    if (backlogClosed > 0) {
      console.log(`📋 ${backlogClosed} gap${backlogClosed === 1 ? '' : 's'} marked ✅ in GAPS_BACKLOG.md\n`);
    }
  }

  if (changed === 0) {
    console.log('✅ TEST_CASES.md and TEST_API.md are already in sync — nothing to update.\n');
  } else {
    console.log(`✅ Registries updated (${changed} change${changed === 1 ? '' : 's'}).\n`);
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
