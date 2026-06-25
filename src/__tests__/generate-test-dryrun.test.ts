import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// generate_test persists POM files to disk during generation so the spec call can
// re-read them. A dry run must roll those writes back — otherwise `dry_run: true`
// silently mutates the user's pages/ directory. These are structural guards (the full
// tool needs live LLM calls to exercise); they lock in the rollback wiring so it can't
// be removed without a failing test. Verified end-to-end against a real no-fixtures
// project: a dry run wrote a new POM method for the spec, then left pages/ unchanged.
const SRC = readFileSync(resolve(__dirname, '../tools/generate-test.ts'), 'utf-8');

describe('generate_test dry run leaves no POM writes behind', () => {
  it('rolls back persisted POMs inside the dry-run branch before returning', () => {
    const dryRunIdx = SRC.indexOf('if (args.dry_run)');
    expect(dryRunIdx).toBeGreaterThan(-1);
    const returnIdx = SRC.indexOf('return {', dryRunIdx);
    expect(returnIdx).toBeGreaterThan(dryRunIdx);
    const block = SRC.slice(dryRunIdx, returnIdx);
    expect(block).toContain('restorePomWrites()');
  });

  it('records each POM\'s prior state immediately before writing it', () => {
    const writeRe = /await safeWrite\(abs, file\.content, \{ allowOverwrite: true \}\)/g;
    const positions: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = writeRe.exec(SRC)) !== null) positions.push(m.index);

    // There is at least one orchestration-phase POM write…
    expect(positions.length).toBeGreaterThan(0);
    // …and every one of them is preceded by a recordPomWrite(abs) so the rollback works.
    for (const pos of positions) {
      const preceding = SRC.slice(Math.max(0, pos - 160), pos);
      expect(preceding).toContain('recordPomWrite(abs)');
    }
  });
});
