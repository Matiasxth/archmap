import { discoverFiles } from './file-discovery.js';
import { parseFiles } from '../parsers/index.js';
import { buildDependencyGraph } from '../analysis/dependency-graph.js';
import { detectModules, inferLayers } from '../analysis/module-boundaries.js';
import { inferRules } from '../analysis/rule-inference.js';
import { analyzeGitHistory } from '../git/history-analyzer.js';
import type { ScanResult, ScanOptions } from '../types.js';

/**
 * Main scanner orchestrator.
 * Coordinates: file discovery → parsing → analysis → output.
 */
export async function scanProject(
  root: string,
  options: ScanOptions,
): Promise<ScanResult> {
  const startTime = Date.now();

  // 1. Discover files
  const files = await discoverFiles(root, options.config);

  // 2. Parse all files
  const parseResults = await parseFiles(files);

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

  const scanDuration = Date.now() - startTime;

  return {
    manifest: {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      generatedBy: 'archmap@0.1.0',
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
