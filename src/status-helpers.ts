/**
 * Render a plain-English "what to do next" summary for `npm run status`, from a
 * flat list of human-readable issue sentences collected during the report.
 */
export function buildBottomLine(issues: string[]): string[] {
  if (issues.length === 0) {
    return ['✅ Bottom line: everything looks healthy — no action needed.'];
  }
  return [
    `⚠️  Bottom line: ${issues.length} thing${issues.length === 1 ? '' : 's'} could use attention:`,
    '',
    ...issues.map((issue) => `• ${issue}`),
  ];
}
