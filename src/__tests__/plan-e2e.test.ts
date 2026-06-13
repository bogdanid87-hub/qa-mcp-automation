import { describe, it, expect } from 'vitest';
import { buildE2EChecklist, formatE2EChecklist, type E2EChecklistItem } from '../tools/plan-e2e';
import { getPomIndex } from '../tools/list-resources';

describe('buildE2EChecklist (against the real POM Method Index)', () => {
  it('reports no changes needed when an existing POM already has all planned methods', async () => {
    const index = await getPomIndex();
    const plan = {
      poms: [
        { file: 'pages/ViewCartPage.ts', is_new: false, methods: ['getRowProductName', 'getRowUnitPrice'], page_url: '/view_cart' },
      ],
    };
    const [item] = buildE2EChecklist(plan, index);
    expect(item).toEqual({
      file: 'pages/ViewCartPage.ts',
      page_url: '/view_cart',
      is_new: false,
      pom_exists: true,
      methods_to_add: [],
      reuse: [],
    });
  });

  it('flags a planned method that already exists on a different POM class as a reuse opportunity', async () => {
    const index = await getPomIndex();
    const plan = {
      poms: [
        { file: 'pages/ViewCartPage.ts', is_new: false, methods: ['getCardPrice'], page_url: '/view_cart' },
      ],
    };
    const [item] = buildE2EChecklist(plan, index);
    expect(item.methods_to_add).toEqual([]);
    expect(item.reuse).toEqual([{ method: 'getCardPrice', existingClass: 'ProductsPage', existingFile: 'pages/ProductsPage.ts' }]);
  });

  it('lists a genuinely new method (not present anywhere) under methods_to_add', async () => {
    const index = await getPomIndex();
    const plan = {
      poms: [
        { file: 'pages/ViewCartPage.ts', is_new: false, methods: ['applyCouponCode'], page_url: '/view_cart' },
      ],
    };
    const [item] = buildE2EChecklist(plan, index);
    expect(item.pom_exists).toBe(true);
    expect(item.methods_to_add).toEqual(['applyCouponCode']);
    expect(item.reuse).toEqual([]);
  });

  it('marks a planned POM that does not exist on disk as pom_exists: false', async () => {
    const index = await getPomIndex();
    const plan = {
      poms: [
        { file: 'pages/CheckoutPage.ts', is_new: true, methods: ['fillDeliveryAddress', 'clickPlaceOrder'], page_url: '/checkout' },
      ],
    };
    const [item] = buildE2EChecklist(plan, index);
    expect(item.pom_exists).toBe(false);
    expect(item.methods_to_add).toEqual(['fillDeliveryAddress', 'clickPlaceOrder']);
    expect(item.reuse).toEqual([]);
  });

  it('flags reuse for a new POM whose planned method name collides with an existing one elsewhere', async () => {
    const index = await getPomIndex();
    const plan = {
      poms: [
        { file: 'pages/CheckoutPage.ts', is_new: true, methods: ['verifyLoaded'], page_url: '/checkout' },
      ],
    };
    const [item] = buildE2EChecklist(plan, index);
    expect(item.pom_exists).toBe(false);
    expect(item.methods_to_add).toEqual([]);
    expect(item.reuse).toHaveLength(1);
    expect(item.reuse[0].method).toBe('verifyLoaded');
  });
});

describe('formatE2EChecklist', () => {
  it('returns a placeholder message for an empty checklist', () => {
    expect(formatE2EChecklist([])).toBe('No POMs needed — this journey can be written entirely against existing pages.');
  });

  it('renders a markdown table with one row per checklist item', () => {
    const checklist: E2EChecklistItem[] = [
      {
        file: 'pages/ViewCartPage.ts',
        page_url: '/view_cart',
        is_new: false,
        pom_exists: true,
        methods_to_add: [],
        reuse: [],
      },
      {
        file: 'pages/CheckoutPage.ts',
        page_url: '/checkout',
        is_new: true,
        pom_exists: false,
        methods_to_add: ['fillDeliveryAddress'],
        reuse: [{ method: 'getRowTotal', existingClass: 'ViewCartPage', existingFile: 'pages/ViewCartPage.ts' }],
      },
    ];
    const formatted = formatE2EChecklist(checklist);

    expect(formatted).toContain('### E2E Plan Checklist');
    expect(formatted).toContain('| 1 | /view_cart | `pages/ViewCartPage.ts` | yes | no changes needed — all methods already exist |');
    expect(formatted).toContain('create with: fillDeliveryAddress');
    expect(formatted).toContain('⚠️ reuse ViewCartPage.getRowTotal() (pages/ViewCartPage.ts) — do not add a forwarding alias');
  });
});
