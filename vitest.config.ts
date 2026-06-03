import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    // Vitest processes TypeScript source but the imports use .js extensions
    // (required for the MCP server runtime). Strip .js so Vite finds the .ts files.
    alias: [{ find: /^(\.{1,2}\/.+)\.js$/, replacement: '$1' }],
  },
});
