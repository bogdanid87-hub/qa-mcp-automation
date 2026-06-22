// Shared launcher for the qa-mcp-engine bins.
//
// The engine ships as TypeScript source (no build step). The repo runs it via
// `tsx src/...`, which registers BOTH the ESM and CJS loader hooks — needed
// because the package is `type: "commonjs"`. Re-running tsx's CLI as a child
// process reproduces that exact setup from any consumer's install, with no
// reliance on node_modules/.bin being on PATH. stdio is inherited so the MCP
// server's stdio transport and the CLIs' interactive I/O pass through unchanged.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Run an engine entry `.ts` file through tsx, forwarding argv + exit code.
 *
 * Every command except `qa-init` needs an mcp-qa.config.json in the current
 * directory. Without the preflight, the engine reads config eagerly at import
 * time, so a config-less run (e.g. `qa-status` before `qa-init`) would surface
 * as a raw stack trace before the CLI's own error handling runs. Checking here
 * lets us print the one-line "run qa-init first" hint cleanly instead.
 */
export function run(relPath, { requiresConfig = true } = {}) {
  if (requiresConfig && !existsSync(join(process.cwd(), 'mcp-qa.config.json'))) {
    process.stderr.write(
      '\nNo mcp-qa.config.json found in this directory.\n' +
      'Run `npx qa-init --name <name> --url <site-url>` to set up this project first.\n\n',
    );
    process.exit(1);
  }

  const tsxCli = require.resolve('tsx/cli');
  const target = fileURLToPath(new URL(relPath, import.meta.url));
  const { status, signal } = spawnSync(
    process.execPath,
    [tsxCli, target, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  if (signal) process.kill(process.pid, signal);
  process.exit(status ?? 1);
}
