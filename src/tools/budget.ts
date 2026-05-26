/** Pricing for claude-sonnet-4-6 (USD per token). */
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;

export class TokenBudget {
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(public readonly limitUsd: number) {}

  add(inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
  }

  get cost(): number {
    return this.inputTokens * INPUT_COST_PER_TOKEN + this.outputTokens * OUTPUT_COST_PER_TOKEN;
  }

  get exceeded(): boolean {
    return this.cost >= this.limitUsd;
  }

  get summary(): string {
    return `$${this.cost.toFixed(4)} of $${this.limitUsd.toFixed(2)} limit`;
  }
}
