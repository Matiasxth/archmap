import { dirname, join, resolve, relative, extname } from 'path';
import { existsSync } from 'fs';
import type { ParseResult, DependencyGraph, DependencyEdge } from '../types.js';
import type { ProjectIndex } from './project-index.js';

/**
 * Build a directed dependency graph from parsed import data.
 *
 * Three-step resolution (universal):
 *   1. Try relative resolution (./  ../  .)
 *   2. Try project index (absolute internal imports)
 *   3. If neither → external
 */
export function buildDependencyGraph(
  parseResults: ParseResult[],
  root: string,
  projectIndex?: ProjectIndex,
): DependencyGraph {
  const fileSet = new Set(parseResults.map((r) => r.filePath));
  const edges: DependencyEdge[] = [];
  const nodeIds = new Set<string>();
  const externalDeps = new Set<string>();

  for (const result of parseResults) {
    nodeIds.add(result.filePath);

    for (const imp of result.imports) {
      // Three-step universal resolution
      let resolved: string | null = null;

      // Step 1: Try relative resolution
      if (imp.isRelative) {
        resolved = result.language === 'python'
          ? resolvePythonImport(result.filePath, imp.source, fileSet)
          : result.language === 'rust'
            ? resolveRustImport(result.filePath, imp.source, fileSet)
            : result.language === 'java'
              ? resolveJavaImport(imp.source, fileSet)
              : resolveRelativeImport(result.filePath, imp.source, root, fileSet);
      }

      // Step 2: Try project index (absolute internal imports)
      if (!resolved && !imp.isRelative && projectIndex) {
        resolved = projectIndex.resolve(imp.source, result.language, result.filePath);
      }

      // Step 3: Add edge if resolved, otherwise external
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
      } else if (!imp.isRelative) {
        externalDeps.add(getPackageName(imp.source));
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
 * Resolve a Python import (dot notation) to a file path.
 * "from .utils import foo" with file at "app/services/main.py" → "app/services/utils.py"
 * "from models.user import User" → "models/user.py"
 */
function resolvePythonImport(
  fromFile: string,
  importSource: string,
  fileSet: Set<string>,
): string | null {
  const dir = dirname(fromFile);

  if (importSource.startsWith('.')) {
    // Relative import: count leading dots
    const dots = importSource.match(/^\.+/)![0].length;
    const modulePath = importSource.slice(dots);

    let baseDir = dir;
    for (let i = 1; i < dots; i++) {
      baseDir = dirname(baseDir);
    }

    if (!modulePath) {
      // "from . import x" — refers to __init__.py in current package
      const initFile = join(baseDir, '__init__.py').replace(/\\/g, '/');
      return fileSet.has(initFile) ? initFile : null;
    }

    const asPath = modulePath.replace(/\./g, '/');
    return resolvePythonPath(baseDir, asPath, fileSet);
  }

  // Absolute import: try from project root
  const asPath = importSource.replace(/\./g, '/');
  return resolvePythonPath('', asPath, fileSet);
}

function resolvePythonPath(
  baseDir: string,
  modulePath: string,
  fileSet: Set<string>,
): string | null {
  const fullPath = baseDir ? join(baseDir, modulePath).replace(/\\/g, '/') : modulePath;

  // Try as a file: module.py
  const asFile = fullPath + '.py';
  if (fileSet.has(asFile)) return asFile;

  // Try as a package: module/__init__.py
  const asPackage = join(fullPath, '__init__.py').replace(/\\/g, '/');
  if (fileSet.has(asPackage)) return asPackage;

  return null;
}

/**
 * Resolve a Rust import (crate::, self::, super::, or mod name) to a file.
 */
function resolveRustImport(
  fromFile: string,
  importSource: string,
  fileSet: Set<string>,
): string | null {
  const dir = dirname(fromFile);

  // mod declaration: look for mod_name.rs or mod_name/mod.rs
  if (!importSource.includes('::')) {
    const asFile = join(dir, importSource + '.rs').replace(/\\/g, '/');
    if (fileSet.has(asFile)) return asFile;
    const asMod = join(dir, importSource, 'mod.rs').replace(/\\/g, '/');
    if (fileSet.has(asMod)) return asMod;
    return null;
  }

  // crate:: paths: strip crate:: and convert :: to /
  let path = importSource;
  if (path.startsWith('crate::')) path = path.slice(7);
  else if (path.startsWith('self::')) path = path.slice(6);
  else if (path.startsWith('super::')) {
    path = path.slice(7);
    const parent = dirname(dir);
    return resolveRustPath(parent, path, fileSet);
  }

  // Try from src/ root
  return resolveRustPath('src', path, fileSet) ?? resolveRustPath('', path, fileSet);
}

function resolveRustPath(baseDir: string, modPath: string, fileSet: Set<string>): string | null {
  const parts = modPath.split('::');
  const filePath = baseDir ? join(baseDir, ...parts).replace(/\\/g, '/') : parts.join('/');

  const asFile = filePath + '.rs';
  if (fileSet.has(asFile)) return asFile;

  const asMod = join(filePath, 'mod.rs').replace(/\\/g, '/');
  if (fileSet.has(asMod)) return asMod;

  // Try without the last part (it might be a symbol, not a module)
  if (parts.length > 1) {
    const parentPath = baseDir ? join(baseDir, ...parts.slice(0, -1)).replace(/\\/g, '/') : parts.slice(0, -1).join('/');
    const parentFile = parentPath + '.rs';
    if (fileSet.has(parentFile)) return parentFile;
    const parentMod = join(parentPath, 'mod.rs').replace(/\\/g, '/');
    if (fileSet.has(parentMod)) return parentMod;
  }

  return null;
}

/**
 * Resolve a Java import (package path) to a file.
 */
function resolveJavaImport(
  importSource: string,
  fileSet: Set<string>,
): string | null {
  // Java: com.example.auth → com/example/auth.java or nested
  const asPath = importSource.replace(/\./g, '/');

  // Try as directory with files
  for (const file of fileSet) {
    if (file.replace(/\\/g, '/').includes(asPath)) return file;
  }

  // Try as a direct file
  const asFile = asPath + '.java';
  if (fileSet.has(asFile)) return asFile;

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
