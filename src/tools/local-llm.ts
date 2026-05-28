const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const LOCAL_MODEL = process.env.LOCAL_MODEL ?? 'qwen2.5-coder:14b';
const TIMEOUT_MS = 300_000; // 5 min — 14B model can be slow on first token

/**
 * Returns true if Ollama is reachable and the configured model is downloaded.
 * Used to decide whether to route POM generation through the local model.
 *
 * For parallel POM builds, Ollama must be started with OLLAMA_NUM_PARALLEL=4
 * (or higher). Without it, concurrent requests are queued sequentially.
 * Set via: launchctl setenv OLLAMA_NUM_PARALLEL 4 && killall ollama
 */
export async function isLocalLlmAvailable(): Promise<boolean> {
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

/**
 * Call the local model via Ollama's chat API.
 * Uses format:"json" to guarantee parseable output.
 * Throws on network error or non-2xx response.
 */
export async function callLocalLlm(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: LOCAL_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,  // near-deterministic for code generation
        num_ctx: 16384,    // 16 K context — enough for system prompt + codebase context
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { message: { content: string } };
  return data.message.content;
}

export { LOCAL_MODEL };
