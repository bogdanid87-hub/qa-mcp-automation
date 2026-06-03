/**
 * Shared post-processing utilities for LLM-generated code.
 *
 * The local model (qwen2.5-coder:14b) has two known recurring issues
 * when generating code that will be embedded into existing files:
 *
 *   1. Markdown fences — wraps TypeScript in ```typescript ... ``` even
 *      when the content is a string value inside a JSON response field.
 *
 *   2. Duplicate imports — adds its own import block when generating a
 *      function or snippet that will be appended to an existing file that
 *      already has those imports at the top.
 *
 * Always run generated code through these helpers before writing to disk.
 */

/**
 * Strip markdown code fences from a string.
 * Handles: ```typescript, ```ts, ```javascript, ```js, and plain ```.
 */
export function stripFences(code: string): string {
  return code
    .replace(/^```(?:typescript|ts|javascript|js)?\r?\n?/m, '')
    .replace(/\r?\n?```\s*$/m, '')
    .trim();
}

/**
 * Strip top-level import statements from generated code.
 * Use when appending a snippet to a file that already has the imports.
 */
export function stripImports(code: string): string {
  return code
    .split('\n')
    .filter(line => !line.trimStart().startsWith('import '))
    .join('\n')
    .replace(/^\n+/, ''); // remove leading blank lines left by removed imports
}

export interface CleanCodeOptions {
  /** Remove markdown fences — always true, included for explicitness */
  stripFences?: boolean;
  /** Remove import statements — use when appending to an existing file */
  stripImports?: boolean;
}

/**
 * Clean LLM-generated code before writing to disk.
 * Strips markdown fences and optionally import statements.
 * Always trims surrounding whitespace.
 */
export function cleanLlmCode(raw: string, opts: CleanCodeOptions = {}): string {
  let code = stripFences(raw);
  if (opts.stripImports) code = stripImports(code);
  return code.trim();
}

/**
 * Extract the first JSON object from an LLM response.
 * Handles markdown fences (```json ... ```) and preamble prose before the object.
 * Throws if no JSON object is found.
 */
export function extractJson(raw: string): string {
  const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try { JSON.parse(stripped); return stripped; } catch { /* fall through */ }
  const lineStart = stripped.search(/(?:^|\n)\s*\{/);
  const start = lineStart !== -1 ? stripped.indexOf('{', lineStart) : stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  throw new Error('No JSON object found in response');
}
