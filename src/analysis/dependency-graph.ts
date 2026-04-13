import { dirname, join, resolve, relative, extname } from 'path';
import { existsSync } from 'fs';
import type { ParseResult, DependencyGraph, DependencyEdge } from '../types.js';

/**
 * Build a directed dependency graph from parsed import data.
 * Resolves relative imports to actual file paths.
 */
export function buildDependencyGraph(
  parseResults: ParseResult[],
  root: string,
): DependencyGraph {
  const fileSet = new Set(parseResults.map((r) => r.filePath));
  const edges: DependencyEdge[] = [];
  const nodeIds = new Set<string>();
  const externalDeps = new Set<string>();

  for (const result of parseResults) {
    nodeIds.add(result.filePath);

    for (const imp of result.imports) {
      if (imp.isRelative) {
        const resolved = resolveRelativeImport(result.filePath, imp.source, root, fileSet);
        if (resolved) {
          const existing = edges.find(
            (e) => e.source === result.filePath && e.target === resolved,
          );
          if (existing) {
            existing.weight++;
            existing.references.push({
              file: result.filePath,
              line: imp.line,
              symbol: imp.specifiers[0] ?? '*',
            });
          } else {
            edges.push({
              source: result.filePath,
              target: resolved,
              type: imp.isDynamic ? 'dynamic' : 'import',
              weight: 1,
              references: [
                {
                  file: result.filePath,
                  line: imp.line,
                  symbol: imp.specifiers[0] ?? '*',
                },
              ],
            });
          }
          nodeIds.add(resolved);
        }
      } else {
        // External dependency
        const pkgName = getPackageName(imp.source);
        externalDeps.add(pkgName);
      }
    }
  }

  const nodes = [
    ...Array.from(nodeIds).map((id) => ({
      id,
      label: id.split('/').pop() ?? id,
      type: 'module' as const,
    })),
    ...Array.from(externalDeps).map((id) => ({
      id: `ext:${id}`,
      label: id,
      type: 'external' as const,
    })),
  ];

  return { nodes, edges, layers: [] };
}

/**
 * Resolve a relative import to an actual file path in the project.
 */
function resolveRelativeImport(
  fromFile: string,
  importSource: string,
  root: string,
  fileSet: Set<string>,
): string | null {
  const dir = dirname(fromFile);
  const rawTarget = join(dir, importSource).replace(/\\/g, '/');

  // Try exact match first
  if (fileSet.has(rawTarget)) return rawTarget;

  // Strip .js/.mjs/.cjs extension (TypeScript uses .js in imports for .ts files)
  const stripped = rawTarget.replace(/\.(js|mjs|cjs)$/, '');

  // Try adding extensions (both with and without stripping)
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
  for (const base of [rawTarget, stripped]) {
    for (const ext of extensions) {
      const withExt = base + ext;
      if (fileSet.has(withExt)) return withExt;
    }
  }

  // Try index files
  for (const base of [rawTarget, stripped]) {
    for (const ext of extensions) {
      const indexFile = join(base, `index${ext}`).replace(/\\/g, '/');
      if (fileSet.has(indexFile)) return indexFile;
    }
  }

  return null;
}

/**
 * Extract npm package name from import source (handles scoped packages).
 */
function getPackageName(source: string): string {
  if (source.startsWith('@')) {
    const parts = source.split('/');
    return parts.slice(0, 2).join('/');
  }
  return source.split('/')[0];
}

/**
 * Detect circular dependencies in the graph.
 */
export function findCircularDeps(graph: DependencyGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  function dfs(node: string) {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push([...path.slice(cycleStart), node]);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      dfs(neighbor);
    }

    stack.delete(node);
    path.pop();
  }

  for (const node of adjacency.keys()) {
    dfs(node);
  }

  return cycles;
}
