import { dirname, basename } from 'path';
import type { ParseResult, ModuleInfo, DependencyGraph } from '../types.js';
import type { ArchmapConfig } from '../types.js';

/**
 * Detect module boundaries based on directory structure.
 * A "module" is a directory under a module root that contains source files.
 */
export function detectModules(
  parseResults: ParseResult[],
  graph: DependencyGraph,
  config: ArchmapConfig,
): ModuleInfo[] {
  const moduleMap = new Map<string, ParseResult[]>();

  for (const result of parseResults) {
    const moduleId = getModuleId(result.filePath, config.moduleRoots);
    if (!moduleMap.has(moduleId)) {
      moduleMap.set(moduleId, []);
    }
    moduleMap.get(moduleId)!.push(result);
  }

  const modules: ModuleInfo[] = [];

  for (const [moduleId, files] of moduleMap) {
    // Collect all exports from the module
    const allExports = files.flatMap((f) => f.exports);

    // Find the index/barrel file exports (public API)
    const indexFile = files.find(
      (f) =>
        basename(f.filePath).match(/^index\.[tj]sx?$/) ||
        basename(f.filePath) === basename(moduleId) + '.ts' ||
        basename(f.filePath) === basename(moduleId) + '.js',
    );
    const publicExports = indexFile ? indexFile.exports : allExports;

    // Determine internal dependencies (other modules this one imports from)
    const internalDeps = new Set<string>();
    const externalDeps = new Set<string>();

    for (const file of files) {
      for (const imp of file.imports) {
        if (imp.isRelative) {
          // Check if the import target is in a different module
          for (const edge of graph.edges) {
            if (edge.source === file.filePath) {
              const targetModule = getModuleId(edge.target, config.moduleRoots);
              if (targetModule !== moduleId) {
                internalDeps.add(targetModule);
              }
            }
          }
        } else {
          const pkgName = imp.source.startsWith('@')
            ? imp.source.split('/').slice(0, 2).join('/')
            : imp.source.split('/')[0];
          externalDeps.add(pkgName);
        }
      }
    }

    // Detect primary language
    const langCounts = new Map<string, number>();
    for (const f of files) {
      langCounts.set(f.language, (langCounts.get(f.language) ?? 0) + 1);
    }
    const primaryLanguage = [...langCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0] ?? 'unknown';

    modules.push({
      id: moduleId,
      name: basename(moduleId),
      path: moduleId,
      type: 'directory',
      language: primaryLanguage,
      files: files.map((f) => f.filePath),
      publicApi: { exports: publicExports },
      internalDependencies: [...internalDeps],
      externalDependencies: [...externalDeps],
    });
  }

  return modules.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Get the module ID for a file path.
 * E.g., "src/auth/middleware.ts" → "src/auth"
 */
function getModuleId(filePath: string, moduleRoots: string[]): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  // Find the module root prefix
  let rootIdx = -1;
  for (const root of moduleRoots) {
    const idx = parts.indexOf(root);
    if (idx !== -1 && (rootIdx === -1 || idx < rootIdx)) {
      rootIdx = idx;
    }
  }

  if (rootIdx !== -1 && parts.length > rootIdx + 2) {
    // Return root/firstDir (e.g., src/auth)
    return parts.slice(rootIdx, rootIdx + 2).join('/');
  }

  // Fallback: use the directory
  return dirname(normalized);
}

/**
 * Infer dependency layers from the module graph using topological analysis.
 */
export function inferLayers(
  modules: ModuleInfo[],
): Array<{ name: string; modules: string[] }> {
  // Build adjacency for modules
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const mod of modules) {
    adj.set(mod.id, new Set());
    inDegree.set(mod.id, 0);
  }

  for (const mod of modules) {
    for (const dep of mod.internalDependencies) {
      if (adj.has(dep)) {
        adj.get(mod.id)!.add(dep);
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm for topological layers
  const layers: Array<{ name: string; modules: string[] }> = [];
  const remaining = new Set(modules.map((m) => m.id));

  while (remaining.size > 0) {
    // Find nodes with in-degree 0 (within remaining)
    const layer: string[] = [];
    for (const id of remaining) {
      let deg = 0;
      for (const mod of modules) {
        if (remaining.has(mod.id) && mod.internalDependencies.includes(id)) {
          deg++;
        }
      }
      if (deg === 0) layer.push(id);
    }

    if (layer.length === 0) {
      // Circular deps — dump remaining
      layers.push({ name: `layer-${layers.length + 1}`, modules: [...remaining] });
      break;
    }

    layers.push({ name: `layer-${layers.length + 1}`, modules: layer });
    for (const id of layer) remaining.delete(id);
  }

  return layers;
}
