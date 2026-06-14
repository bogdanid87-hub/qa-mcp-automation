import { describe, it, expect } from 'vitest';
import { buildCandidatesSection, mergeCandidatesSection } from '../tools/generate-app-knowledge';

const HEADER = '# App Knowledge Candidates\n\nReview periodically and delete entries once promoted or dismissed.\n\n';

describe('buildCandidatesSection', () => {
  it('formats a single candidate with header and trailing separator', () => {
    const section = buildCandidatesSection(
      [{ area: 'Search', note: 'No #search_product element found on /products.' }],
      'audit_site — https://example.com (data)',
      '2026-06-14',
    );
    expect(section).toBe(
      '## 2026-06-14 — audit_site — https://example.com (data)\n\n' +
      '- **Search**: No #search_product element found on /products.\n\n' +
      '---\n',
    );
  });

  it('formats multiple candidates as separate bullet lines', () => {
    const section = buildCandidatesSection(
      [
        { area: 'Site structure', note: 'Universal elements across all 5 page types: #header, #footer.' },
        { area: 'Checkout', note: 'Guest checkout is not offered — login required.' },
      ],
      'analyze_coverage — tests/ui/checkout.spec.ts',
      '2026-06-14',
    );
    expect(section).toBe(
      '## 2026-06-14 — analyze_coverage — tests/ui/checkout.spec.ts\n\n' +
      '- **Site structure**: Universal elements across all 5 page types: #header, #footer.\n' +
      '- **Checkout**: Guest checkout is not offered — login required.\n\n' +
      '---\n',
    );
  });
});

describe('mergeCandidatesSection', () => {
  it('appends a new section when no section for this source exists', () => {
    const section = buildCandidatesSection(
      [{ area: 'Search', note: 'No search input found.' }],
      'audit_site — https://example.com (data)',
      '2026-06-14',
    );
    const result = mergeCandidatesSection(HEADER, section, 'audit_site — https://example.com (data)');
    expect(result).toBe(HEADER.trimEnd() + '\n\n' + section);
  });

  it('replaces an existing section for the same source, preserving other sources', () => {
    const sectionOther = buildCandidatesSection(
      [{ area: 'Checkout', note: 'Guest checkout is not offered.' }],
      'analyze_coverage — tests/ui/checkout.spec.ts',
      '2026-06-01',
    );
    const staleSection = buildCandidatesSection(
      [{ area: 'Site structure', note: 'old observation' }],
      'audit_site — https://example.com (structure)',
      '2026-06-01',
    );
    const existing = HEADER.trimEnd() + '\n\n' + sectionOther + '\n' + staleSection;

    const refreshedSection = buildCandidatesSection(
      [{ area: 'Site structure', note: 'new observation' }],
      'audit_site — https://example.com (structure)',
      '2026-06-14',
    );
    const result = mergeCandidatesSection(existing, refreshedSection, 'audit_site — https://example.com (structure)');

    expect(result).toContain(refreshedSection);
    expect(result).toContain(sectionOther);
    expect(result).not.toContain('old observation');
  });

  it('appends a new section for a different source, leaving existing sections intact', () => {
    const sectionOther = buildCandidatesSection(
      [{ area: 'Checkout', note: 'Guest checkout is not offered.' }],
      'analyze_coverage — tests/ui/checkout.spec.ts',
      '2026-06-01',
    );
    const existing = HEADER.trimEnd() + '\n\n' + sectionOther;

    const newSection = buildCandidatesSection(
      [{ area: 'Site structure', note: 'new observation' }],
      'audit_site — https://example.com (structure)',
      '2026-06-14',
    );
    const result = mergeCandidatesSection(existing, newSection, 'audit_site — https://example.com (structure)');

    expect(result).toContain(sectionOther);
    expect(result).toContain(newSection);
  });
});
