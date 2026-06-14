import { join } from 'path';
import { mkdir } from 'fs/promises';

const ROOT = process.cwd();

/** Directory for all user-facing working files — inputs the user writes and outputs the tools generate for human consumption. */
export const WORKSPACE = join(ROOT, 'workspace');

/** Ensure the workspace directory exists before writing to it. */
export async function ensureWorkspace(): Promise<void> {
  await mkdir(WORKSPACE, { recursive: true });
}

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
