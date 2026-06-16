/** Pricing for claude-sonnet-4-6 (USD per token). */
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;
const CACHE_WRITE_COST_PER_TOKEN = 3.75 / 1_000_000;
const CACHE_READ_COST_PER_TOKEN = 0.30 / 1_000_000;

/** Rough chars-per-token ratio used for pre-flight estimates before a call's
 *  actual usage is known (Claude's tokenizer averages ~4 chars/token for English/code). */
const CHARS_PER_TOKEN = 4;

/**
 * Tracks API spend against an optional cap.
 *
 * Scope: the cap governs the **auto-fix loop only** (investigate-fix.ts), whose job
 * is to stop a fix loop from burning tokens. Test/POM/spec generation is
 * intentionally NOT bound by the cap and does not accrue against it — a complex
 * test can legitimately need many generation tokens, and capping generation could
 * starve the very loop the cap exists to protect.
 */
export class TokenBudget {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheWriteTokens = 0;
  private cacheReadTokens = 0;

  constructor(public readonly limitUsd: number) {}

  add(inputTokens: number, outputTokens: number, cacheWriteTokens = 0, cacheReadTokens = 0): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.cacheWriteTokens += cacheWriteTokens;
    this.cacheReadTokens += cacheReadTokens;
  }

  get cost(): number {
    return (
      this.inputTokens * INPUT_COST_PER_TOKEN +
      this.outputTokens * OUTPUT_COST_PER_TOKEN +
      this.cacheWriteTokens * CACHE_WRITE_COST_PER_TOKEN +
      this.cacheReadTokens * CACHE_READ_COST_PER_TOKEN
    );
  }

  get capped(): boolean {
    return isFinite(this.limitUsd);
  }

  get exceeded(): boolean {
    return this.capped && this.cost >= this.limitUsd;
  }

  get summary(): string {
    return this.capped
      ? `$${this.cost.toFixed(4)} of $${this.limitUsd.toFixed(2)} limit`
      : `$${this.cost.toFixed(4)} spent`;
  }

  /** Rough pre-flight token estimate for a block of text (~4 chars/token). */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Projected total cost (current spend plus an upcoming call) if that call used
   * `estimatedInputTokens` input and `estimatedOutputTokens` output tokens, assuming
   * no cache hit — the worst case, since pre-flight can't know cache state.
   */
  projectedCost(estimatedInputTokens: number, estimatedOutputTokens: number): number {
    return this.cost
      + estimatedInputTokens * INPUT_COST_PER_TOKEN
      + estimatedOutputTokens * OUTPUT_COST_PER_TOKEN;
  }

  /**
   * True when a call of this estimated size would meet or exceed the limit.
   * Always false for an uncapped budget. Callers decide what "would exceed" means
   * for them — e.g. the fix loop aborts the call, a generation tool just warns.
   */
  wouldExceed(estimatedInputTokens: number, estimatedOutputTokens: number): boolean {
    return this.capped && this.projectedCost(estimatedInputTokens, estimatedOutputTokens) >= this.limitUsd;
  }
}
