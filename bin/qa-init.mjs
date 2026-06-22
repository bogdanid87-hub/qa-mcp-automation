#!/usr/bin/env node
// qa-init — bootstrap mcp-qa.config.json + scaffold for a new project.
// Works in an empty consumer repo: the init_project chain deliberately avoids
// importing config.ts (whose singleton throws when no config exists yet).
import { run } from './_run.mjs';
run('../src/init-project-cli.ts', { requiresConfig: false });
