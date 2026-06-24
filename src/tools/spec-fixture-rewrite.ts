/**
 * Deterministic post-generation fix: rewrite `const x = new SomePage(page)` in a
 * generated spec to the project's injected fixture, so specs obtain page helpers via
 * fixtures (the convention) rather than direct instantiation. The engine's review
 * pass only *flags* `new` usage; this enforces it without relying on the model.
 *
 * Conservative by construction: an occurrence is only rewritten when its fixture can
 * be fully resolved AND its enclosing `async ({ … }) =>` callback is found. Anything
 * ambiguous is left exactly as-is, so the transform can never produce a broken spec.
 */
import { detectFixtureShape } from './learn-conventions.js';

/** className → fixtureName, from fixtures/index.ts. First fixture wins for a given class. */
export function buildFixtureMap(fixturesContent: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of detectFixtureShape(fixturesContent).injectedFixtures) {
    const cls = f.type.trim();
    if (/^[A-Z]\w*$/.test(cls) && !map.has(cls)) map.set(cls, f.name);
  }
  return map;
}

/** The path a POM's goto()/navigate() targets (first `navigate('<path>')` literal), or null. */
export function pomPrimaryPath(pomContent: string): string | null {
  const m = pomContent.match(/navigate\(\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

/**
 * Repoint a spec's `test`/`expect` import away from '@playwright/test' to the project's
 * fixtures module (the convention) — using the base `test` bypasses the custom fixtures
 * (ad-blocking, page-object fixtures, trackCleanup). Non-fixture names imported from
 * '@playwright/test' (Page, Locator, APIResponse, …) are kept on a separate import.
 * `fixturesPath` is the spec-relative path to the fixtures module (e.g. '../../fixtures').
 * Returns the spec unchanged if it doesn't import `test` from '@playwright/test'.
 */
export function rewriteFixturesImport(spec: string, fixturesPath: string): { content: string; changed: boolean } {
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]@playwright\/test['"]\s*;?/;
  const m = spec.match(re);
  if (!m) return { content: spec, changed: false };

  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.includes('test')) return { content: spec, changed: false }; // e.g. only `APIResponse` — fine

  const fixtureNames = names.filter((n) => n === 'test' || n === 'expect');
  const rest = names.filter((n) => n !== 'test' && n !== 'expect');

  let replacement = `import { ${fixtureNames.join(', ')} } from '${fixturesPath}';`;
  if (rest.length) replacement += `\nimport { ${rest.join(', ')} } from '@playwright/test';`;

  return { content: spec.replace(re, replacement), changed: true };
}

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Reverse of rewriteNewPomFixtures: for a project that has NO test fixtures (it
 * instantiates page objects directly), rewrite a generated spec's fixture-injection
 * back to `const x = new XPage(page)`. The engine's prompt is biased toward
 * fixture-injection and ignores the convention inconsistently, so this enforces the
 * instantiation style deterministically.
 *
 * An injected param is converted only when its PascalCase name is a real POM class
 * (`loginPage` → `LoginPage` ∈ pomClasses); built-ins (`page`, `request`, …) are left.
 * `importPathFor(className)` gives the spec-relative import path for each class.
 * Also repoints the `test`/`expect` import to '@playwright/test' (no fixtures module).
 */
export function rewriteToInstantiation(
  spec: string,
  pomClasses: Set<string>,
  importPathFor: (className: string) => string,
): { content: string; changed: boolean } {
  // No fixtures module exists — test/expect come from @playwright/test.
  const working = spec.replace(
    /import\s*\{([^}]*\btest\b[^}]*)\}\s*from\s*['"][^'"]+['"]\s*;?/,
    (_m, names) => `import {${names}} from '@playwright/test';`,
  );

  const classesToImport = new Set<string>();
  let out = '';
  let cursor = 0;
  CALLBACK_RE.lastIndex = 0;
  let cb: RegExpExecArray | null;
  while ((cb = CALLBACK_RE.exec(working)) !== null) {
    const names = cb[1].split(',').map((s) => s.trim()).filter(Boolean);
    const pomParams = names.filter((n) => pomClasses.has(pascal(n)));
    const bodyOpen = working.indexOf('{', cb.index + cb[0].length - 1);
    const bodyEnd = matchBrace(working, bodyOpen);
    if (pomParams.length === 0) { out += working.slice(cursor, bodyEnd); cursor = bodyEnd; continue; }

    const kept = names.filter((n) => !pomParams.includes(n));
    if (!kept.includes('page')) kept.unshift('page');
    const decls = pomParams.map((p) => { classesToImport.add(pascal(p)); return `  const ${p} = new ${pascal(p)}(page);`; }).join('\n');
    const body = working.slice(bodyOpen + 1, bodyEnd - 1);

    out += working.slice(cursor, cb.index) + `async ({ ${kept.join(', ')} }) => {\n${decls}\n${body}}`;
    cursor = bodyEnd;
  }
  out += working.slice(cursor);

  if (classesToImport.size === 0) return { content: working, changed: false };

  const imports = [...classesToImport].sort().map((c) => `import { ${c} } from '${importPathFor(c)}';`).join('\n');
  const firstNlAfterImport = out.indexOf('\n', out.indexOf('import '));
  out = firstNlAfterImport === -1
    ? `${imports}\n${out}`
    : `${out.slice(0, firstNlAfterImport + 1)}${imports}\n${out.slice(firstNlAfterImport + 1)}`;
  return { content: out, changed: true };
}

const CALLBACK_RE = /async\s*\(\s*\{([^}]*)\}\s*\)\s*=>\s*\{/g;
const NEW_DECL_RE = /[ \t]*(?:const|let)\s+(\w+)\s*=\s*new\s+(\w+)\s*\(\s*page\s*\)\s*;?[ \t]*\n?/g;

/** Find the index just past the matching `}` for the `{` at `openIdx`. */
function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i + 1;
  }
  return src.length;
}

export interface RewriteResult {
  content: string;
  /** Human-readable description of each rewrite applied, for the generation output. */
  rewrites: string[];
}

/**
 * Rewrite `new <Class>(page)` → injected fixture within each test callback.
 *
 * @param typeToFixture   className → fixtureName (from buildFixtureMap).
 * @param resolveAncestor optional resolver for a base/intermediate class that has no
 *                        direct fixture (e.g. `BasePage` → the fixture for the page
 *                        under test). Return undefined to leave the occurrence alone.
 */
export function rewriteNewPomFixtures(
  spec: string,
  typeToFixture: Map<string, string>,
  resolveAncestor?: (className: string) => string | undefined,
): RewriteResult {
  const rewrites: string[] = [];
  const removedClasses = new Set<string>();

  // Rebuild the file callback-by-callback so var replacement stays scoped to each test.
  let out = '';
  let cursor = 0;
  CALLBACK_RE.lastIndex = 0;
  let cb: RegExpExecArray | null;
  while ((cb = CALLBACK_RE.exec(spec)) !== null) {
    const destructure = cb[1];
    const bodyOpen = spec.indexOf('{', cb.index + cb[0].length - 1);
    const bodyEnd = matchBrace(spec, bodyOpen); // includes closing brace
    let body = spec.slice(bodyOpen + 1, bodyEnd - 1);

    const added: string[] = [];
    NEW_DECL_RE.lastIndex = 0;
    let decl: RegExpExecArray | null;
    const toApply: { varName: string; fixture: string; className: string }[] = [];
    while ((decl = NEW_DECL_RE.exec(body)) !== null) {
      const [, varName, className] = decl;
      const fixture = typeToFixture.get(className) ?? resolveAncestor?.(className);
      if (fixture) toApply.push({ varName, fixture, className });
    }

    for (const { varName, fixture, className } of toApply) {
      body = body.replace(NEW_DECL_RE, (m, v) => (v === varName ? '' : m)); // drop the decl line
      body = body.replace(new RegExp(`\\b${varName}\\b`, 'g'), fixture);      // var → fixture (scoped to this body)
      added.push(fixture);
      removedClasses.add(className);
      rewrites.push(`${className}: replaced \`new ${className}(page)\` with the \`${fixture}\` fixture`);
    }

    let newDestructure = destructure;
    if (added.length) {
      const names = destructure.split(',').map((s) => s.trim()).filter(Boolean);
      for (const fx of added) if (!names.includes(fx)) names.push(fx);
      // Drop `page` if the rewritten body no longer references it.
      const kept = names.filter((n) => n !== 'page' || /\bpage\b/.test(body));
      newDestructure = ` ${kept.join(', ')} `;
    }

    out += spec.slice(cursor, cb.index) + `async ({${newDestructure}}) => {` + body + '}';
    cursor = bodyEnd;
  }
  out += spec.slice(cursor);

  // Remove now-unused imports of rewritten classes.
  for (const cls of removedClasses) {
    if (!new RegExp(`\\b${cls}\\b`).test(out.replace(new RegExp(`import\\s*\\{[^}]*\\b${cls}\\b[^}]*\\}\\s*from[^\\n]*\\n`, 'g'), ''))) {
      out = out.replace(new RegExp(`import\\s*\\{\\s*${cls}\\s*\\}\\s*from\\s*['"][^'"]+['"]\\s*;?\\n`, 'g'), '');
    }
  }

  return { content: out, rewrites };
}
