import Anthropic from '@anthropic-ai/sdk';
import { getSystemBlocks, buildUserBlocks } from '../prompts/system.js';
import { readFocusedContextForFeature, getPomIndex } from './list-resources.js';
import { inspectPages, formatSnapshots } from './inspect-page.js';
import { extractJson } from './llm-utils.js';
import { MODEL, PLAN_ONLY_HINT, type PomPlan } from './generate-test.js';
import type { PomIndexEntry } from './pom-index.js';

export interface E2EChecklistItem {
  file: string;
  page_url?: string;
  is_new: boolean;
  pom_exists: boolean;
  /** Methods that genuinely don't exist anywhere yet and need to be written. */
  methods_to_add: string[];
  /** Methods Claude planned that already exist on another POM class — reuse instead of duplicating. */
  reuse: { method: string; existingClass: string; existingFile: string }[];
}

/**
 * Cross-references a generation plan's `{poms: [{file, is_new, methods, page_url}]}`
 * against the real POM Method Index, turning each planned POM into a
 * step → view → exists? → action checklist entry. Pure function — no API calls.
 */
export function buildE2EChecklist(plan: { poms: PomPlan[] }, index: PomIndexEntry[]): E2EChecklistItem[] {
  return plan.poms.map((pomPlan) => {
    const entry = index.find((e) => e.file === pomPlan.file);
    const existingMethodNames = new Set(entry?.methods.map((m) => m.name) ?? []);

    const methods_to_add: string[] = [];
    const reuse: E2EChecklistItem['reuse'] = [];

    for (const method of pomPlan.methods) {
      if (existingMethodNames.has(method)) continue;

      const elsewhere = index.find((e) => e.file !== pomPlan.file && e.methods.some((m) => m.name === method));
      if (elsewhere) {
        reuse.push({ method, existingClass: elsewhere.className, existingFile: elsewhere.file });
      } else {
        methods_to_add.push(method);
      }
    }

    return {
      file: pomPlan.file,
      page_url: pomPlan.page_url,
      is_new: pomPlan.is_new,
      pom_exists: entry !== undefined,
      methods_to_add,
      reuse,
    };
  });
}

/** Render an E2E checklist as a markdown table: step → view → POM → exists? → action. */
export function formatE2EChecklist(checklist: E2EChecklistItem[]): string {
  if (checklist.length === 0) {
    return 'No POMs needed — this journey can be written entirely against existing pages.';
  }

  const lines: string[] = [
    '### E2E Plan Checklist',
    '',
    '| Step | View | POM | Exists? | Action |',
    '|---|---|---|---|---|',
  ];

  checklist.forEach((item, i) => {
    const view = item.page_url ?? '(n/a)';
    const exists = item.pom_exists ? 'yes' : 'no';

    const actions: string[] = [];
    if (!item.pom_exists) {
      actions.push(`create with: ${item.methods_to_add.join(', ') || '(locators only)'}`);
    } else if (item.methods_to_add.length > 0) {
      actions.push(`add: ${item.methods_to_add.join(', ')}`);
    }
    for (const r of item.reuse) {
      actions.push(`⚠️ reuse ${r.existingClass}.${r.method}() (${r.existingFile}) — do not add a forwarding alias`);
    }
    if (actions.length === 0) actions.push('no changes needed — all methods already exist');

    lines.push(`| ${i + 1} | ${view} | \`${item.file}\` | ${exists} | ${actions.join('; ')} |`);
  });

  return lines.join('\n');
}

/**
 * Plans a multi-page E2E journey without writing any files: asks Claude to
 * decompose it into the POMs each step needs (same shape generate_test uses
 * internally for its orchestrated flow), then cross-references the result
 * against the real POM Method Index to flag reuse opportunities before any
 * code is written.
 */
export async function planE2eTool(args: {
  description: string;
  page_paths?: string[];
}): Promise<{ content: { type: 'text'; text: string }[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'Error: ANTHROPIC_API_KEY environment variable is not set.' }] };
  }

  const featureKeywords = args.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 10);
  const existingContext = await readFocusedContextForFeature(featureKeywords);

  let domContext = '';
  if (args.page_paths && args.page_paths.length > 0) {
    try {
      const snapshots = await inspectPages(args.page_paths);
      domContext = formatSnapshots(snapshots);
    } catch (err: any) {
      domContext = `(Page inspection failed: ${err.message} — proceeding without DOM snapshot)`;
    }
  }

  const client = new Anthropic({ apiKey });
  const systemBlocks = await getSystemBlocks();
  const userBlocks = buildUserBlocks({
    description: args.description + PLAN_ONLY_HINT,
    existingContext,
    domContext,
  });

  let raw: string;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemBlocks,
      messages: [{ role: 'user', content: userBlocks }],
    });
    raw = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Claude API error: ${err.message}` }] };
  }

  let plan: { poms: PomPlan[] };
  try {
    plan = JSON.parse(extractJson(raw));
  } catch {
    return { content: [{ type: 'text', text: `Claude returned invalid JSON.\n\n${raw}` }] };
  }

  const index = await getPomIndex();
  const checklist = buildE2EChecklist(plan, index);

  return { content: [{ type: 'text', text: formatE2EChecklist(checklist) }] };
}
