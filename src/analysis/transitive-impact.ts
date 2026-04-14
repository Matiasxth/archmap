import type { DependencyGraph, CriticalPath } from '../types.js';

/**
 * Compute transitive impact for each file.
 * "If this file changes, how many files are affected transitively?"
 *
 * Uses BFS on the inverted dependency graph (follow who imports FROM this file).
 */
export function computeTransitiveImpact(graph: DependencyGraph): Map<string, number> {
  // Build adjacency: file → files that import it (inverted)
  const dependents = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    if (!dependents.has(edge.target)) dependents.set(edge.target, new Set());
    dependents.get(edge.target)!.add(edge.source);
  }

  const impact = new Map<string, number>();

  for (const node of graph.nodes) {
    if (node.type === 'external') continue;
    const reached = bfsReach(node.id, dependents);
    impact.set(node.id, reached);
  }

  return impact;
}

/**
 * BFS: count how many unique nodes are reachable from `start` following inverted edges.
 */
function bfsReach(start: string, adjacency: Map<string, Set<string>>): number {
  const visited = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const n of neighbors) {
      if (!visited.has(n) && n !== start) {
        visited.add(n);
        queue.push(n);
      }
    }
  }

  return visited.size;
}

/**
 * Find critical paths: the longest dependency chains in the graph.
 * A change at the root of a long chain has the highest cascading risk.
 */
export function findCriticalPaths(graph: DependencyGraph, maxPaths: number = 10): CriticalPath[] {
  // Build forward adjacency: file → files it imports
  const imports = new Map<string, string[]>();
  const allNodes = new Set<string>();

  for (const edge of graph.edges) {
    if (!imports.has(edge.source)) imports.set(edge.source, []);
    imports.get(edge.source)!.push(edge.target);
    allNodes.add(edge.source);
    allNodes.add(edge.target);
  }

  // Find roots: nodes that nothing imports (leaf files like pages/routes)
  const hasIncoming = new Set(graph.edges.map((e) => e.target));
  const roots = [...allNodes].filter((n) => !hasIncoming.has(n));

  // DFS from each root to find longest paths
  const allPaths: CriticalPath[] = [];

  for (const root of roots) {
    const longestFromRoot = dfsLongestPath(root, imports, new Set());
    if (longestFromRoot.length >= 3) {
      allPaths.push({
        files: longestFromRoot,
        length: longestFromRoot.length,
        rootFile: longestFromRoot[longestFromRoot.length - 1], // deepest dependency
        leafFile: longestFromRoot[0], // the starting node (nothing imports it)
      });
    }
  }

  // Sort by length descending, take top N
  return allPaths
    .sort((a, b) => b.length - a.length)
    .slice(0, maxPaths);
}

function dfsLongestPath(node: string, adjacency: Map<string, string[]>, visited: Set<string>): string[] {
  if (visited.has(node)) return [node]; // cycle protection
  visited.add(node);

  const neighbors = adjacency.get(node) ?? [];
  let longest: string[] = [];

  for (const neighbor of neighbors) {
    const path = dfsLongestPath(neighbor, adjacency, new Set(visited));
    if (path.length > longest.length) {
      longest = path;
    }
  }

  visited.delete(node);
  return [node, ...longest];
}

/**
 * Compute fan-in for each file (how many files import it).
 */
export function computeFanIn(graph: DependencyGraph): Map<string, number> {
  const fanIn = new Map<string, number>();

  for (const edge of graph.edges) {
    fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
  }

  return fanIn;
}
