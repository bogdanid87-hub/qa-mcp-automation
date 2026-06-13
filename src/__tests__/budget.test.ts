import { describe, it, expect } from 'vitest';
import { TokenBudget } from '../tools/budget';

describe('TokenBudget.estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(TokenBudget.estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('rounds up for partial tokens', () => {
    expect(TokenBudget.estimateTokens('abc')).toBe(1);
    expect(TokenBudget.estimateTokens('')).toBe(0);
  });
});

describe('TokenBudget.projectedCost', () => {
  it('adds the estimated call on top of current spend', () => {
    const budget = new TokenBudget(Infinity);
    const before = budget.projectedCost(0, 0);
    const after = budget.projectedCost(1_000_000, 1_000_000);
    // 1M input @ $3/M + 1M output @ $15/M = $18 on top of current spend
    expect(after - before).toBeCloseTo(18, 5);
  });

  it('includes already-spent cost from add()', () => {
    const budget = new TokenBudget(Infinity);
    budget.add(1_000_000, 0); // $3
    expect(budget.projectedCost(0, 0)).toBeCloseTo(3, 5);
  });
});

describe('TokenBudget.wouldExceed', () => {
  it('is always false for an uncapped budget', () => {
    const budget = new TokenBudget(Infinity);
    expect(budget.wouldExceed(10_000_000, 10_000_000)).toBe(false);
  });

  it('is false when the projected cost stays under the limit', () => {
    const budget = new TokenBudget(10); // $10 cap
    // 100 input + 100 output tokens is a tiny fraction of $10
    expect(budget.wouldExceed(100, 100)).toBe(false);
  });

  it('is true when the projected cost would meet or exceed the limit', () => {
    const budget = new TokenBudget(0.01); // 1 cent cap
    // 10k input tokens alone = $0.03, already over the cap
    expect(budget.wouldExceed(10_000, 0)).toBe(true);
  });

  it('accounts for spend already tracked via add()', () => {
    const budget = new TokenBudget(0.01); // 1 cent cap
    budget.add(3_000, 0); // ~$0.009 spent already
    // a further 1k input tokens (~$0.003) pushes projected cost over $0.01
    expect(budget.wouldExceed(1_000, 0)).toBe(true);
  });
});

describe('TokenBudget.exceeded vs wouldExceed', () => {
  it('wouldExceed can be true before exceeded is true — that is the point of a pre-flight check', () => {
    const budget = new TokenBudget(0.01);
    budget.add(3_000, 0); // under the cap so far
    expect(budget.exceeded).toBe(false);
    expect(budget.wouldExceed(1_000, 0)).toBe(true);
  });
});
