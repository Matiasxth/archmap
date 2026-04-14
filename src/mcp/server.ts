import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getVersion } from '../utils/version.js';

/**
 * archmap MCP Server.
 * Exposes architecture data as tools that AI agents can query in real-time.
 */
export function createMcpServer(root: string) {
  const server = new McpServer({
    name: 'archmap',
    version: getVersion(),
  });

  const archmapDir = join(root, '.archmap');

  async function loadJson(filename: string): Promise<any> {
    const filePath = join(archmapDir, filename);
    if (!existsSync(filePath)) {
      throw new Error(`No .archmap/ found. Run \`archmap init\` first.`);
    }
    return JSON.parse(await readFile(filePath, 'utf-8'));
  }

  // Tool: get_modules — list all modules with their public APIs
  server.tool(
    'get_modules',
    'List all modules in the codebase with their public APIs, dependencies, and file counts',
    {},
    async () => {
      const data = await loadJson('modules.json');
      const summary = data.modules.map((m: any) => ({
        id: m.id,
        name: m.name,
        language: m.language,
        files: m.files.length,
        exports: m.publicApi.exports.map((e: any) => `${e.name} (${e.type})`),
        internalDeps: m.internalDependencies,
        externalDeps: m.externalDependencies,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    },
  );

  // Tool: get_module — get details for a specific module
  server.tool(
    'get_module',
    'Get detailed information about a specific module including all files, exports, and dependencies',
    { module_id: z.string().describe('Module ID (e.g., "src/auth")') },
    async ({ module_id }) => {
      const data = await loadJson('modules.json');
      const mod = data.modules.find((m: any) => m.id === module_id || m.name === module_id);
      if (!mod) {
        return { content: [{ type: 'text' as const, text: `Module "${module_id}" not found. Available: ${data.modules.map((m: any) => m.id).join(', ')}` }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(mod, null, 2) }] };
    },
  );

  // Tool: get_dependencies — query dependency graph
  server.tool(
    'get_dependencies',
    'Get dependency graph — who imports what. Optionally filter by a specific module.',
    { module_id: z.string().optional().describe('Filter to deps of this module (optional)') },
    async ({ module_id }) => {
      const data = await loadJson('dependencies.json');
      let edges = data.graph.edges;

      if (module_id) {
        edges = edges.filter(
          (e: any) => e.source.startsWith(module_id) || e.target.startsWith(module_id),
        );
      }

      const result = {
        edges: edges.map((e: any) => ({
          from: e.source,
          to: e.target,
          type: e.type,
          weight: e.weight,
        })),
        layers: data.graph.layers,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool: get_rules — list architectural rules with tier filter
  server.tool(
    'get_rules',
    'List architectural rules sorted by confidence. Filter by tier (rule/convention/observation) and/or category (boundary/co-change/naming/layer).',
    {
      tier: z.enum(['rule', 'convention', 'observation']).optional().describe('Filter by tier'),
      category: z.enum(['boundary', 'co-change', 'naming', 'layer', 'ownership']).optional().describe('Filter by category'),
      min_confidence: z.number().optional().describe('Minimum confidence 0-1 (default: 0)'),
    },
    async ({ tier, category, min_confidence }) => {
      const data = await loadJson('rules.json');
      let filtered = data.rules;
      if (tier) filtered = filtered.filter((r: any) => r.tier === tier);
      if (category) filtered = filtered.filter((r: any) => r.category === category);
      if (min_confidence) filtered = filtered.filter((r: any) => r.confidence >= min_confidence);
      filtered = filtered.sort((a: any, b: any) => b.confidence - a.confidence);
      return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }] };
    },
  );

  // Tool: get_health — project health score and breakdown
  server.tool(
    'get_health',
    'Get project health score (0-100), tier breakdown, and per-module scores',
    {},
    async () => {
      const manifest = await loadJson('manifest.json');
      return { content: [{ type: 'text' as const, text: JSON.stringify(manifest.health, null, 2) }] };
    },
  );

  // Tool: get_parsing_stats — AST vs regex breakdown
  server.tool(
    'get_parsing_stats',
    'Get parsing statistics: how many files were parsed with AST (tree-sitter) vs regex fallback',
    {},
    async () => {
      const manifest = await loadJson('manifest.json');
      return { content: [{ type: 'text' as const, text: JSON.stringify(manifest.stats?.parsing ?? { ast: 0, regex: 0, pct: 0 }, null, 2) }] };
    },
  );

  // Tool: get_contracts — list implicit contracts (co-change patterns)
  server.tool(
    'get_contracts',
    'List implicit contracts: files that always change together based on git history',
    {},
    async () => {
      const data = await loadJson('contracts.json');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.contracts, null, 2) }] };
    },
  );

  // Tool: check_impact — given a file, what else might need to change?
  server.tool(
    'check_impact',
    'Given a file path, check what other files/modules might be impacted by changes to it',
    { file_path: z.string().describe('File path relative to project root (e.g., "src/auth/jwt.ts")') },
    async ({ file_path }) => {
      const [modules, deps, contracts] = await Promise.all([
        loadJson('modules.json'),
        loadJson('dependencies.json'),
        loadJson('contracts.json'),
      ]);

      // Find which module this file belongs to
      const ownerModule = modules.modules.find((m: any) =>
        m.files.includes(file_path),
      );

      // Find files that import from this file
      const dependents = deps.graph.edges
        .filter((e: any) => e.target === file_path)
        .map((e: any) => ({ file: e.source, type: e.type }));

      // Find co-change contracts involving this file
      const relatedContracts = contracts.contracts.filter((c: any) =>
        c.entities.some((e: string) => file_path.includes(e) || e.includes(file_path)),
      );

      // Find resource chain this file belongs to
      let resourceChain = null;
      try {
        const risks = await loadJson('file-risks.json');
        const chains = risks.resourceChains ?? [];
        resourceChain = chains.find((c: any) =>
          c.links.some((l: any) => l.file === file_path || file_path.includes(l.file) || l.file.includes(file_path)),
        );
      } catch { /* optional */ }

      const result = {
        file: file_path,
        module: ownerModule?.id ?? 'unknown',
        dependents,
        coChangeContracts: relatedContracts.map((c: any) => ({
          description: c.description,
          pairedWith: c.entities.filter((e: string) => e !== file_path),
          confidence: c.confidence,
        })),
        resourceChain: resourceChain ? {
          resource: resourceChain.resource,
          isCrossStack: resourceChain.isCrossStack,
          chain: resourceChain.links.map((l: any) => `${l.role}: ${l.file} (${l.language})`),
        } : null,
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool: get_summary — get the full architecture summary as markdown
  server.tool(
    'get_summary',
    'Get the full architecture summary as markdown — useful for initial context loading',
    {},
    async () => {
      const summaryPath = join(archmapDir, 'SUMMARY.md');
      if (!existsSync(summaryPath)) {
        return { content: [{ type: 'text' as const, text: 'No SUMMARY.md found. Run `archmap init` first.' }] };
      }
      const content = await readFile(summaryPath, 'utf-8');
      return { content: [{ type: 'text' as const, text: content }] };
    },
  );

  return server;
}

/**
 * Start the MCP server on stdio transport.
 */
export async function startMcpServer(root: string): Promise<void> {
  const server = createMcpServer(root);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
