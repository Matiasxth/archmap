#!/usr/bin/env node

import { resolve } from 'path';
import { startMcpServer } from '../src/mcp/server.js';

const root = resolve(process.argv[2] ?? '.');
startMcpServer(root).catch((err) => {
  console.error('Failed to start MCP server:', err.message);
  process.exit(1);
});
