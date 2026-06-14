/**
 * Parse metadata embedded in a test description file as leading comment lines:
 *   # test_name: login
 *   # spec_file: tests/ui/auth.spec.ts
 *   # page_paths: /login, /
 * These lines are stripped from the description and returned separately.
 * CLI flags take priority over file metadata when both are provided.
 */
export function parseFileMetadata(raw: string): {
  description: string;
  testName?: string;
  pagePaths?: string[];
  specFile?: string;
  reqId?: string;
} {
  const lines = raw.split('\n');
  let testName: string | undefined;
  let pagePaths: string[] | undefined;
  let specFile: string | undefined;
  let reqId: string | undefined;
  const descLines: string[] = [];

  for (const line of lines) {
    const meta = line.match(/^#\s*(test_name|page_paths|spec_file|req_id)\s*:\s*(.+)/i);
    if (meta) {
      const [, key, value] = meta;
      if (key.toLowerCase() === 'test_name') testName = value.trim();
      if (key.toLowerCase() === 'page_paths') {
        const paths = value.split(',').map(p => p.trim()).filter(Boolean);
        if (paths.length) pagePaths = paths;
      }
      if (key.toLowerCase() === 'spec_file') specFile = value.trim();
      if (key.toLowerCase() === 'req_id') reqId = value.trim();
    } else if (line.startsWith('#')) {
      // skip other comment/instruction lines
    } else {
      descLines.push(line);
    }
  }

  return { description: descLines.join('\n').trim(), testName, pagePaths, specFile, reqId };
}

/**
 * Split a file's content into multiple test sections separated by lines
 * containing only three or more dashes (---).
 * Returns an empty array if there is only one section — caller falls through
 * to the single-test flow.
 */
export function parseMultipleSections(raw: string): Array<{
  description: string;
  testName?: string;
  pagePaths?: string[];
  specFile?: string;
  reqId?: string;
}> {
  const sections = raw.split(/^-{3,}\s*$/m).map(s => s.trim()).filter(Boolean);
  if (sections.length <= 1) return [];
  return sections.map(s => parseFileMetadata(s));
}
