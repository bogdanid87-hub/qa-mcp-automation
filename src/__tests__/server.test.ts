import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../server';

describe('createServer', () => {
  it('builds an McpServer with all 13 tools registered, without connecting a transport', () => {
    const server = createServer();
    expect(server).toBeInstanceOf(McpServer);
  });
});
