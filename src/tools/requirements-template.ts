/**
 * The REQUIREMENTS.md starter template, kept in its own import-free module so
 * bootstrap paths (init_project's templates) can use it without pulling in
 * requirements-registry → test-registry → config.ts's eager config load.
 */
export const REQUIREMENTS_TEMPLATE = `# Requirements

Traceability ledger — maps REQ IDs assigned by analyze_prd back to the requirement
they trace to in the source PRD. Append-only: each ID is permanent once assigned —
do not renumber or remove existing entries. Descriptions may be edited for clarity.

<!-- requirements-start -->
<!-- requirements-end -->
`;
