/** Pricing for claude-sonnet-4-6 (USD per token). */
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;
const CACHE_WRITE_COST_PER_TOKEN = 3.75 / 1_000_000;
const CACHE_READ_COST_PER_TOKEN = 0.30 / 1_000_000;

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
}
