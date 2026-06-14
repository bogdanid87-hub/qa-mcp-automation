import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../tools/generate-pom';
import { config } from '../config';

describe('buildSystemPrompt', () => {
  it('derives the POM hierarchy from config.pom instead of a hardcoded decision tree', async () => {
    const prompt = await buildSystemPrompt();
    const [intermediate] = config.pom.intermediateClasses;

    expect(prompt).toContain(intermediate.name);
    for (const path of intermediate.paths) {
      expect(prompt).toContain(path);
    }
    expect(prompt).not.toContain('Step 1 — Does the page have a grid of multiple product cards');
  });

  it('lists locators/methods already owned by the site and intermediate classes, read live from pages/*.ts', async () => {
    const prompt = await buildSystemPrompt();

    expect(prompt).toContain('#susbscribe_email → subscribeEmailInput');
    expect(prompt).toContain('.features_items .product-image-wrapper → productCards');
  });
});
