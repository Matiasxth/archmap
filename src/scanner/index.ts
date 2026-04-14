import { discoverFiles } from './file-discovery.js';
import { parseFiles } from '../parsers/index.js';
import { buildDependencyGraph } from '../analysis/dependency-graph.js';
import { detectModules, inferLayers } from '../analysis/module-boundaries.js';
import { inferRules } from '../analysis/rule-inference.js';
import { analyzeGitHistory } from '../git/history-analyzer.js';
import { getChangedFiles, saveScanCache } from '../git/diff-tracker.js';
import type { ScanResult, ScanOptions, ParseResult } from '../types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Main scanner orchestrator.
 * Coordinates: file discovery → parsing → analysis → output.
 * Supports incremental scanning: only re-parses files changed since last scan.
 */
export async function scanProject(
  root: string,
  options: ScanOptions,
): Promise<ScanResult> {
  const startTime = Date.now();

  // 1. Discover files
  const files = await discoverFiles(root, options.config);

  // 2. Parse files (incremental if possible)
  let parseResults: ParseResult[];
  const changedFiles = await getChangedFiles(root);

  if (changedFiles !== null && existsSync(join(root, '.archmap', 'parse-cache.json'))) {
    // Incremental: load cache, re-parse only changed files
    try {
      const cacheRaw = await readFile(join(root, '.archmap', 'parse-cache.json'), 'utf-8');
      const cachedResults: ParseResult[] = JSON.parse(cacheRaw);
      const changedSet = new Set(changedFiles.map((f) => f.replace(/\\/g, '/')));

      // Keep cached results for unchanged files
      const unchanged = cachedResults.filter((r) => !changedSet.has(r.filePath));

      // Re-parse only changed files
      const changedDiscovered = files.filter((f) => changedSet.has(f.relativePath));
      const freshResults = await parseFiles(changedDiscovered);

      parseResults = [...unchanged, ...freshResults];
    } catch {
      // Cache corrupted — fall back to full scan
      parseResults = await parseFiles(files);
    }
  } else {
    parseResults = await parseFiles(files);
  }

  // 3. Build dependency graph
  const graph = buildDependencyGraph(parseResults, root);

  // 4. Detect modules
  const modules = detectModules(parseResults, graph, options.config);

  // 5. Infer layers
  const layers = inferLayers(modules);
  graph.layers = layers;

  // Update graph nodes to module level
  const moduleGraph = {
    ...graph,
    nodes: [
      ...modules.map((m) => ({
        id: m.id,
        label: m.name,
        type: 'module' as const,
      })),
      ...graph.nodes.filter((n) => n.type === 'external'),
    ],
  };

  // 6. Infer rules from static analysis
  const rules = inferRules(modules, moduleGraph, parseResults);

  // 7. Analyze git history (optional)
  let contracts: ScanResult['contracts'] = [];
  if (options.gitHistory) {
    try {
      contracts = await analyzeGitHistory(root, options.config);
    } catch {
      // Git history analysis is optional — fail silently
    }
  }

  // Collect unique languages
  const languages = [...new Set(files.map((f) => f.language))];

  // Save caches for incremental scanning
  try {
    const { writeFile: wf, mkdir } = await import('fs/promises');
    const cacheDir = join(root, '.archmap');
    if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
    await wf(join(cacheDir, 'parse-cache.json'), JSON.stringify(parseResults), 'utf-8');
    await saveScanCache(root);
  } catch {
    // Cache save is optional
  }

  const scanDuration = Date.now() - startTime;

  return {
    manifest: {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      generatedBy: 'archmap@0.3.0',
      repoRoot: root,
      languages,
      scanDuration,
    },
    stats: {
      totalFiles: files.length,
      totalModules: modules.length,
      totalDependencies: moduleGraph.edges.length,
      totalRules: rules.length,
      totalContracts: contracts.length,
    },
    modules,
    dependencies: moduleGraph,
    rules,
    contracts,
    parseResults,
  };
}
