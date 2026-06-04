#!/bin/bash
# Retrieve API key from macOS Keychain, falling back to the environment.
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(security find-generic-password -a ANTHROPIC_API_KEY -s anthropic -w 2>/dev/null)}"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY not found in Keychain or environment." >&2
  echo "Run: security add-generic-password -a ANTHROPIC_API_KEY -s anthropic -w 'sk-ant-...'" >&2
  exit 1
fi

export ANTHROPIC_API_KEY
exec npx tsx src/index.ts
