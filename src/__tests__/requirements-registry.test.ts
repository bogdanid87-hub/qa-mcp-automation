import { describe, it, expect } from 'vitest';
import {
  REQUIREMENTS_TEMPLATE,
  parseRequirements,
  appendRequirements,
  normalizeReqId,
  extractSourceRef,
  injectReqId,
  extractRequirementText,
  formatReqHint,
  assignReqIds,
  findUncoveredRequirements,
  findFunctionalOnlyRequirements,
  computeRequirementsCoverage,
} from '../tools/requirements-registry';
import type { TestType } from '../tools/test-registry';

describe('normalizeReqId', () => {
  const cases: [string, string | null][] = [
    ['API 5', 'REQ-API-005'],
    ['API 05', 'REQ-API-005'],
    ['Req-4', 'REQ-004'],
    ['Requirement 7', 'REQ-007'],
    ['US-01', 'REQ-US-001'],
    ['Test Case 12', 'REQ-CASE-012'],
    ['Test Case 3', 'REQ-CASE-003'],
    ['5', 'REQ-005'],
    ['none', null],
    ['', null],
    ['Move Back', null],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" -> ${expected ?? 'null'}`, () => {
      expect(normalizeReqId(input)).toBe(expected);
    });
  }
});

describe('extractSourceRef', () => {
  it('reads the source_ref field value', () => {
    const block = '# test_name: api-5-thing\n# source_ref: API 5\n';
    expect(extractSourceRef(block)).toBe('API 5');
  });

  it('defaults to "none" when the field is absent', () => {
    expect(extractSourceRef('# test_name: some-thing\n')).toBe('none');
  });

  it('reads an explicit "none" value', () => {
    expect(extractSourceRef('# source_ref: none\n')).toBe('none');
  });
});

describe('injectReqId', () => {
  it('inserts req_id right after source_ref', () => {
    const block = '# test_name: api-5-thing\n# source_ref: API 5\n# reason: x';
    const result = injectReqId(block, 'REQ-API-005');
    expect(result).toBe('# test_name: api-5-thing\n# source_ref: API 5\n# req_id: REQ-API-005\n# reason: x');
  });

  it('inserts "req_id: none" when reqId is null', () => {
    const block = '# test_name: some-thing\n# source_ref: none\n';
    const result = injectReqId(block, null);
    expect(result).toContain('# source_ref: none\n# req_id: none');
  });

  it('prepends req_id when source_ref is missing', () => {
    const block = '# test_name: some-thing\n';
    const result = injectReqId(block, 'REQ-001');
    expect(result.startsWith('# req_id: REQ-001\n')).toBe(true);
  });
});

describe('extractRequirementText', () => {
  it('returns the first non-# line', () => {
    const block = '# test_name: x\n# reason: y\n\nPOST to search_product returns 200 for a valid query.\nMore detail.';
    expect(extractRequirementText(block)).toBe('POST to search_product returns 200 for a valid query.');
  });

  it('truncates long descriptions to ~140 chars', () => {
    const long = 'x'.repeat(200);
    const block = `# test_name: x\n${long}`;
    const result = extractRequirementText(block);
    expect(result.length).toBe(140);
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns "" when no description line exists', () => {
    expect(extractRequirementText('# test_name: x\n# reason: y')).toBe('');
  });
});

describe('formatReqHint', () => {
  it('returns "" when reqId is undefined', () => {
    expect(formatReqHint(undefined)).toBe('');
  });

  it('returns "" for the literal "none" (case-insensitive)', () => {
    expect(formatReqHint('none')).toBe('');
    expect(formatReqHint('NONE')).toBe('');
  });

  it('returns a hint sentence containing @req:<id> for a real req id', () => {
    const hint = formatReqHint('REQ-API-005');
    expect(hint).toContain('@req:REQ-API-005');
    expect(hint).toContain('Requirement hint');
  });
});

describe('parseRequirements / appendRequirements', () => {
  it('returns an empty list for the fresh template', () => {
    expect(parseRequirements(REQUIREMENTS_TEMPLATE)).toEqual([]);
  });

  it('parses existing entries', () => {
    const content = REQUIREMENTS_TEMPLATE.replace(
      '<!-- requirements-end -->',
      '- REQ-API-005: POST to search_product returns matching results\n<!-- requirements-end -->',
    );
    expect(parseRequirements(content)).toEqual([
      { id: 'REQ-API-005', text: 'POST to search_product returns matching results' },
    ]);
  });

  it('appends new entries before the end marker', () => {
    const updated = appendRequirements(REQUIREMENTS_TEMPLATE, [
      { id: 'REQ-API-005', text: 'POST to search_product returns matching results' },
      { id: 'REQ-004', text: 'Registering with a used email shows an error' },
    ]);
    expect(parseRequirements(updated)).toEqual([
      { id: 'REQ-API-005', text: 'POST to search_product returns matching results' },
      { id: 'REQ-004', text: 'Registering with a used email shows an error' },
    ]);
  });

  it('does not duplicate an existing id', () => {
    const once = appendRequirements(REQUIREMENTS_TEMPLATE, [{ id: 'REQ-API-005', text: 'First description' }]);
    const twice = appendRequirements(once, [{ id: 'REQ-API-005', text: 'Different description' }]);
    expect(parseRequirements(twice)).toEqual([{ id: 'REQ-API-005', text: 'First description' }]);
  });

  it('preserves existing entries and order', () => {
    let content = appendRequirements(REQUIREMENTS_TEMPLATE, [{ id: 'REQ-001', text: 'First' }]);
    content = appendRequirements(content, [{ id: 'REQ-002', text: 'Second' }]);
    expect(parseRequirements(content)).toEqual([
      { id: 'REQ-001', text: 'First' },
      { id: 'REQ-002', text: 'Second' },
    ]);
  });
});

describe('assignReqIds', () => {
  const rawText = [
    '# test_name: api-5-post-to-search-product\n# spec_file: tests/api/products.spec.ts\n# source: direct\n# risk: high\n# priority: high\n# reason: Search is core to discovery.\n# source_ref: API 5\n\nPOST to search_product returns 200 and matching results for a valid query.',
    '# test_name: api-5-post-to-search-product-missing-param\n# spec_file: tests/api/products.spec.ts\n# source: direct\n# risk: medium\n# priority: medium\n# reason: Negative case for the same endpoint.\n# source_ref: API 5\n\nPOST to search_product without the search_product parameter returns a 400.',
    '# test_name: cart-empty-state-message\n# spec_file: tests/ui/cart.spec.ts\n# source: suggested\n# risk: low\n# priority: low\n# reason: Edge case for an empty cart.\n# source_ref: none\n\nViewing an empty cart shows the "Cart is empty!" message.',
  ].join('\n---\n');

  it('assigns the same req_id to blocks sharing a source_ref, and none to unnumbered/suggested blocks', () => {
    const result = assignReqIds(rawText, REQUIREMENTS_TEMPLATE);

    const blocks = result.rawText.split(/^---$/m).map(b => b.trim());
    expect(blocks[0]).toContain('# req_id: REQ-API-005');
    expect(blocks[1]).toContain('# req_id: REQ-API-005');
    expect(blocks[2]).toContain('# req_id: none');
  });

  it('adds exactly one new ledger entry, using the first block describing that req_id', () => {
    const result = assignReqIds(rawText, REQUIREMENTS_TEMPLATE);

    expect(result.newEntries).toEqual([
      { id: 'REQ-API-005', text: 'POST to search_product returns 200 and matching results for a valid query.' },
    ]);
    expect(parseRequirements(result.updatedRequirementsContent)).toEqual(result.newEntries);
  });

  it('is idempotent — a second run against the updated ledger adds nothing new', () => {
    const first = assignReqIds(rawText, REQUIREMENTS_TEMPLATE);
    const second = assignReqIds(first.rawText, first.updatedRequirementsContent);

    expect(second.newEntries).toEqual([]);
    expect(parseRequirements(second.updatedRequirementsContent)).toEqual(parseRequirements(first.updatedRequirementsContent));
  });
});

describe('findUncoveredRequirements', () => {
  const requirements = [
    { id: 'REQ-API-005', text: 'POST to search_product returns matching results' },
    { id: 'REQ-004', text: 'Registering with a used email shows an error' },
  ];

  it('returns all requirements when none are covered', () => {
    expect(findUncoveredRequirements(requirements, new Set())).toEqual(requirements);
  });

  it('filters out covered requirements', () => {
    expect(findUncoveredRequirements(requirements, new Set(['REQ-API-005']))).toEqual([requirements[1]]);
  });

  it('returns an empty array when all requirements are covered', () => {
    expect(findUncoveredRequirements(requirements, new Set(['REQ-API-005', 'REQ-004']))).toEqual([]);
  });

  it('ignores covered ids that are not in the requirements list', () => {
    expect(findUncoveredRequirements(requirements, new Set(['REQ-999']))).toEqual(requirements);
  });

  it('returns an empty array for an empty requirements list', () => {
    expect(findUncoveredRequirements([], new Set(['REQ-API-005']))).toEqual([]);
  });
});

describe('findFunctionalOnlyRequirements', () => {
  const requirements = [
    { id: 'REQ-API-005', text: 'POST to search_product returns matching results' },
    { id: 'REQ-004', text: 'Registering with a used email shows an error' },
    { id: 'REQ-UI-003', text: 'Cart shows empty state message' },
  ];

  const typesMap = (entries: Array<[string, TestType[]]>): Map<string, Set<TestType>> =>
    new Map(entries.map(([id, types]) => [id, new Set(types)]));

  it('includes a requirement covered only by functional tests', () => {
    const coveredTypes = typesMap([['REQ-API-005', ['functional']]]);
    expect(findFunctionalOnlyRequirements(requirements, coveredTypes)).toEqual([requirements[0]]);
  });

  it('excludes a requirement that also has a negative test', () => {
    const coveredTypes = typesMap([['REQ-API-005', ['functional', 'negative']]]);
    expect(findFunctionalOnlyRequirements(requirements, coveredTypes)).toEqual([]);
  });

  it('excludes a requirement covered only by a boundary test', () => {
    const coveredTypes = typesMap([['REQ-UI-003', ['boundary']]]);
    expect(findFunctionalOnlyRequirements(requirements, coveredTypes)).toEqual([]);
  });

  it('excludes requirements with no covering tests at all', () => {
    const coveredTypes = typesMap([['REQ-API-005', ['functional']]]);
    expect(findFunctionalOnlyRequirements(requirements, coveredTypes)).not.toContainEqual(requirements[1]);
    expect(findFunctionalOnlyRequirements(requirements, coveredTypes)).not.toContainEqual(requirements[2]);
  });

  it('returns an empty array for an empty requirements list', () => {
    expect(findFunctionalOnlyRequirements([], typesMap([['REQ-API-005', ['functional']]]))).toEqual([]);
  });
});

describe('computeRequirementsCoverage', () => {
  it('returns null when REQUIREMENTS.md does not exist (this project has not run analyze_prd against a numbered PRD yet)', async () => {
    expect(await computeRequirementsCoverage()).toBeNull();
  });
});
