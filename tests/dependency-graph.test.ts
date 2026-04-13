import { describe, it, expect } from 'vitest';
import { buildDependencyGraph, findCircularDeps } from '../src/analysis/dependency-graph.js';
import type { ParseResult } from '../src/types.js';

describe('Dependency Graph', () => {
  const makeParseResult = (filePath: string, imports: Array<{ source: string; isRelative: boolean }>): ParseResult => ({
    filePath,
    language: 'typescript',
    imports: imports.map((imp, i) => ({
      ...imp,
      specifiers: ['default'],
      isDynamic: false,
      line: i + 1,
    })),
    exports: [],
  });

  it('builds graph from relative imports', () => {
    const results: ParseResult[] = [
      makeParseResult('src/auth/middleware.ts', [
        { source: './jwt.js', isRelative: true },
        { source: '../db/index.js', isRelative: true },
      ]),
      makeParseResult('src/auth/jwt.ts', [
        { source: '../utils/config.js', isRelative: true },
      ]),
      makeParseResult('src/db/index.ts', []),
      makeParseResult('src/utils/config.ts', []),
    ];

    const graph = buildDependencyGraph(results, '/project');
    expect(graph.edges.length).toBeGreaterThan(0);

    // middleware -> jwt
    const mjEdge = graph.edges.find(
      (e) => e.source === 'src/auth/middleware.ts' && e.target === 'src/auth/jwt.ts',
    );
    expect(mjEdge).toBeDefined();

    // middleware -> db/index
    const mdEdge = graph.edges.find(
      (e) => e.source === 'src/auth/middleware.ts' && e.target === 'src/db/index.ts',
    );
    expect(mdEdge).toBeDefined();
  });

  it('separates internal from external dependencies', () => {
    const results: ParseResult[] = [
      makeParseResult('src/app.ts', [
        { source: './db/index.js', isRelative: true },
        { source: 'express', isRelative: false },
        { source: '@types/node', isRelative: false },
      ]),
      makeParseResult('src/db/index.ts', []),
    ];

    const graph = buildDependencyGraph(results, '/project');
    const externalNodes = graph.nodes.filter((n) => n.type === 'external');
    expect(externalNodes.length).toBe(2);
    expect(externalNodes.map((n) => n.label)).toContain('express');
    expect(externalNodes.map((n) => n.label)).toContain('@types/node');
  });

  it('detects circular dependencies', () => {
    const results: ParseResult[] = [
      makeParseResult('src/a.ts', [{ source: './b.js', isRelative: true }]),
      makeParseResult('src/b.ts', [{ source: './a.js', isRelative: true }]),
    ];

    const graph = buildDependencyGraph(results, '/project');
    const cycles = findCircularDeps(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const graph = buildDependencyGraph([], '/project');
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
