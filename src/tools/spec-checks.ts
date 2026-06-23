/**
 * Deterministic static checks on a generated spec, run before it's recorded as
 * passing. The generation prompt asks for these; this enforces them so a violation
 * fails loudly instead of shipping as a green-but-worthless test.
 *
 * #1 — no-assertion: a test with no assertion "passes" vacuously at runtime, so the
 * test runner can't catch it. We flag a test that neither asserts directly (an
 * `expect(...)` call or a `.expect`/`.verify`/`.assert` POM method) NOR calls a POM
 * method that (transitively) asserts — handling the encapsulated-assertion convention
 * (`await contactPage.expectSuccess()`, `homePage.goto()` that asserts load internally).
 */

// expect(...), expect.poll, await expect, or a `.expectX(/.verifyX(/.assertX(` POM method call.
const ASSERT_SIGNAL = /\bexpect[\s.(]|\.(?:expect|verify|assert)\w*\s*\(/i;
// `receiver.method(` — used to resolve calls to POM assertion methods.
const CALL_RE = /\b(\w+)\.(\w+)\s*\(/g;
// Receivers whose methods are framework built-ins, never project POM methods, so a
// name clash like `page.goto` must NOT resolve to a POM `goto`.
const BUILTIN_RECEIVERS = new Set(['page', 'request', 'expect', 'test', 'console', 'Promise', 'Math', 'JSON', 'Object', 'Array', 'process', 'context', 'browser']);

/** POM-method names called on a non-built-in receiver (e.g. `homePage.goto`, `this.waitFor`). */
function* pomCalls(body: string): Generator<string> {
  for (const m of body.matchAll(CALL_RE)) {
    if (!BUILTIN_RECEIVERS.has(m[1])) yield m[2];
  }
}

/** Index just past the matching `}` for the `{` at openIdx. */
function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i + 1;
  }
  return src.length;
}

/** Extract `async name(...) { body }` definitions from POM source as name → body. */
function extractMethodBodies(pomContents: string[]): Map<string, string> {
  const bodies = new Map<string, string>();
  const defRe = /\basync\s+(\w+)\s*\([^)]*\)\s*(?::[^{;]+)?\{/g;
  for (const content of pomContents) {
    let m: RegExpExecArray | null;
    defRe.lastIndex = 0;
    while ((m = defRe.exec(content)) !== null) {
      const open = content.indexOf('{', m.index + m[0].length - 1);
      bodies.set(m[1], content.slice(open + 1, matchBrace(content, open) - 1));
    }
  }
  return bodies;
}

/**
 * Names of POM methods that assert — directly, or by calling another asserting
 * method. Computed as a fixpoint over the method-call graph so encapsulation at any
 * depth (test → goto → waitForLoaded → expect) is resolved.
 */
export function extractAssertingMethods(pomContents: string[]): Set<string> {
  const bodies = extractMethodBodies(pomContents);
  const asserts = new Set<string>();
  for (const [name, body] of bodies) if (ASSERT_SIGNAL.test(body)) asserts.add(name);

  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, body] of bodies) {
      if (asserts.has(name)) continue;
      for (const called of pomCalls(body)) {
        if (asserts.has(called)) { asserts.add(name); changed = true; break; }
      }
    }
  }
  return asserts;
}

/** True if a test body asserts directly or via a known asserting POM method. */
function bodyAsserts(body: string, assertingMethods: Set<string>): boolean {
  if (ASSERT_SIGNAL.test(body)) return true;
  for (const called of pomCalls(body)) {
    if (assertingMethods.has(called)) return true;
  }
  return false;
}

/**
 * API methods called as `<fixtureName>.method(...)` in `spec` that don't exist on the
 * detected API-client class — the engine surfaces the real signatures to generation, but
 * a model can still invent one (e.g. `apiClient.post()` instead of `apiClient.verifyLogin()`).
 * Returns the unknown method names so generation can flag them precisely.
 */
export function findUnknownApiClientCalls(spec: string, fixtureName: string, knownMethods: Set<string>): string[] {
  const re = new RegExp(`\\b${fixtureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\w+)\\s*\\(`, 'g');
  const unknown = new Set<string>();
  for (const m of spec.matchAll(re)) {
    if (!knownMethods.has(m[1])) unknown.add(m[1]);
  }
  return [...unknown];
}

/**
 * Names of `test(...)` blocks in `spec` that contain no assertion (directly or via an
 * asserting POM method). `assertingMethods` comes from extractAssertingMethods over the
 * project's POMs. A non-empty result means the spec has a vacuously-passing test.
 */
export function findNonAssertingTests(spec: string, assertingMethods: Set<string>): string[] {
  const offenders: string[] = [];
  // test('name', async ...) / test.only / test.fixme — skip test.describe/step.
  const testRe = /\btest(?:\.(?:only|skip|fixme))?\s*\(\s*(['"`])([\s\S]*?)\1\s*,\s*async\b/g;
  let m: RegExpExecArray | null;
  while ((m = testRe.exec(spec)) !== null) {
    // The callback body opens at the first `{` AFTER the arrow — not the destructure
    // brace in `async ({ page }) => {`.
    const arrow = spec.indexOf('=>', m.index + m[0].length);
    if (arrow === -1) continue;
    const open = spec.indexOf('{', arrow);
    if (open === -1) continue;
    const body = spec.slice(open + 1, matchBrace(spec, open) - 1);
    if (!bodyAsserts(body, assertingMethods)) offenders.push(m[2]);
  }
  return offenders;
}
