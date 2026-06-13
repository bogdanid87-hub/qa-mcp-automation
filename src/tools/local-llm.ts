import { runGuardedShellDetached } from '../lib/shell-guard.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const LOCAL_MODEL = process.env.LOCAL_MODEL ?? 'qwen2.5-coder:14b';
const TIMEOUT_MS = 300_000; // 5 min — 14B model can be slow on first token
const STARTUP_POLL_MS = 1_000;
const STARTUP_TIMEOUT_MS = 20_000;

// ── Internal helpers ───────────────────────────────────────────────────────────

async function checkOllamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    const data = await res.json() as { models: { name: string }[] };
    const base = LOCAL_MODEL.split(':')[0];
    return data.models.some(m => m.name.startsWith(base));
  } catch {
    return false;
  }
}

/** Launch the Ollama macOS app and wait up to STARTUP_TIMEOUT_MS for it to respond. */
async function tryStartOllama(): Promise<boolean> {
  // Try the macOS app first; fall back to `ollama serve` if the app isn't installed
  runGuardedShellDetached('open -a Ollama 2>/dev/null || ollama serve &>/dev/null &');

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, STARTUP_POLL_MS));
    if (await checkOllamaReachable()) return true;
  }
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the local LLM is available for POM generation.
 *
 * Behaviour when Ollama is NOT running:
 *   - NO_LOCAL_LLM=1 env var set → return false silently (session opt-out)
 *   - MCP server context (non-TTY) → warn to stderr, return false
 *   - Interactive CLI → prompt the user, try to start Ollama if they agree;
 *     set NO_LOCAL_LLM=1 for the rest of the session on refusal or failure
 *
 * For parallel POM builds set OLLAMA_NUM_PARALLEL=4:
 *   launchctl setenv OLLAMA_NUM_PARALLEL 4 && killall ollama
 */
export async function isLocalLlmAvailable(): Promise<boolean> {
  // Session-level opt-out (set by --no-local flag or user declining the prompt)
  if (process.env.NO_LOCAL_LLM === '1') return false;

  if (await checkOllamaReachable()) return true;

  // ── Ollama is not running ──────────────────────────────────────────────────

  // MCP server / non-interactive context — can't prompt, warn and fall back
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `[qa-mcp] ⚠️  Ollama is not running — falling back to Claude API for POM generation. ` +
      `Start Ollama or set NO_LOCAL_LLM=1 to suppress this warning.\n`,
    );
    return false;
  }

  // Interactive CLI — ask the user
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve =>
    rl.question('\n⚡ Ollama is not running. Start it now? [Y/n] ', ans => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    }),
  );

  if (answer === 'n' || answer === 'no') {
    process.env.NO_LOCAL_LLM = '1'; // suppress for the rest of this session
    console.log('  Using Claude API instead.\n');
    return false;
  }

  console.log('  Starting Ollama...');
  const started = await tryStartOllama();

  if (started) {
    console.log('  ✅ Ollama is ready.\n');
    return true;
  }

  console.log('  ⚠️  Could not start Ollama — falling back to Claude API.\n');
  process.env.NO_LOCAL_LLM = '1'; // don't ask again
  return false;
}

/**
 * Call the local model via Ollama's chat API.
 * Uses format:"json" to guarantee parseable output.
 * Throws on network error or non-2xx response.
 */
// Appended to every system prompt sent to the local model.
// Prevents the two most common local LLM code-generation issues:
//   1. Wrapping TypeScript in markdown fences inside JSON string values
//   2. Adding import statements when the output is a snippet, not a full file
const LOCAL_LLM_CONSTRAINTS = `
## Output constraints (CRITICAL — follow exactly)
- When your JSON response contains TypeScript code in a string field, write the TypeScript DIRECTLY — do NOT wrap it in markdown fences (\`\`\`typescript ... \`\`\`)
- Do NOT include import statements unless the instructions explicitly say this is a complete standalone file
- Raw TypeScript only inside JSON string values — no code fences, no preamble`;

export async function callLocalLlm(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: LOCAL_MODEL,
      messages: [
        { role: 'system', content: systemPrompt + LOCAL_LLM_CONSTRAINTS },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_ctx: 16384,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama API error ${res.status}: ${body}`);
  }

  let data: { message: { content: string } };
  try {
    data = await res.json() as { message: { content: string } };
  } catch (err) {
    throw new Error(`Ollama returned unparseable response (${(err as Error).message}) — check model health`);
  }
  if (data?.message?.content == null) {
    throw new Error('Ollama response missing message.content — model may have returned an empty or malformed response');
  }
  return data.message.content;
}

export { LOCAL_MODEL };
