#!/usr/bin/env node
// qa-learn — detect an existing project's test conventions (read-only, token-free).
// Config-independent (reads the existing project's code, not mcp-qa.config.json),
// so it can run before qa-init to preview a project's conventions.
import { run } from './_run.mjs';
run('../src/learn-conventions-cli.ts', { requiresConfig: false });
