#!/usr/bin/env node
// qa-status — suite health at a glance (reads the registries; no live tests).
import { run } from './_run.mjs';
run('../src/status-cli.ts');
