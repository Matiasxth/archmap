import { resolve } from 'path';
import { startMcpServer } from '../mcp/server.js';

export async function mcpCommand(options: { root: string }) {
  const root = resolve(options.root);
  await startMcpServer(root);
}
