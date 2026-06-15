import { join } from 'path';
import { mkdir } from 'fs/promises';

const ROOT = process.cwd();

/** Directory for all user-facing working files — inputs the user writes and outputs the tools generate for human consumption. */
export const WORKSPACE = join(ROOT, 'workspace');

/** Ensure the workspace directory exists before writing to it. */
export async function ensureWorkspace(): Promise<void> {
  await mkdir(WORKSPACE, { recursive: true });
}

export const MY_TEST_TEMPLATE =
  '# Describe the test you want to generate below.\n' +
  '# New here? See workspace/START_HERE.md for a walkthrough.\n' +
  '#\n' +
  '# Directives (optional):\n' +
  '#   test_name: my-test-name\n' +
  '#   spec_file: tests/ui/my-feature.spec.ts\n' +
  '#   page_paths: /login, /checkout\n\n' +
  'Describe your test scenario here...\n';

export const PRD_TEMPLATE =
  '# PRD — paste your product requirements document here.\n' +
  '# New here? See workspace/START_HERE.md for a walkthrough.\n\n' +
  'Replace this with your PRD content...\n';

export const WORKSPACE_PATHS = {
  myTest:          join(WORKSPACE, 'my-test.txt'),
  prd:             join(WORKSPACE, 'prd.md'),
  prdTests:        join(WORKSPACE, 'prd-tests.txt'),
  coverageReport:  join(WORKSPACE, 'coverage-report.md'),
  coverageGaps:    join(WORKSPACE, 'coverage-gaps.txt'),
  gapsBacklog:     join(WORKSPACE, 'GAPS_BACKLOG.md'),
  appKnowledge:    join(WORKSPACE, 'APP_KNOWLEDGE.md'),
  appKnowledgeManual: join(WORKSPACE, 'APP_KNOWLEDGE_MANUAL.md'),
  appKnowledgeCandidates: join(WORKSPACE, 'APP_KNOWLEDGE_CANDIDATES.md'),
  siteAuditReport: join(WORKSPACE, 'site-audit-report.md'),
};
