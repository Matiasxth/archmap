import { discoverFiles } from './file-discovery.js';
import { parseFiles } from '../parsers/index.js';
import { buildDependencyGraph } from '../analysis/dependency-graph.js';
import { detectModules, inferLayers } from '../analysis/module-boundaries.js';
import { inferRules } from '../analysis/rule-inference.js';
import { analyzeGitHistory } from '../git/history-analyzer.js';
import { getChangedFiles, saveScanCache } from '../git/diff-tracker.js';
import { loadManualRules } from '../analysis/manual-rules.js';
import { computeHealthScore } from '../analysis/health-score.js';
import { computeTransitiveImpact, findCriticalPaths, computeFanIn } from '../analysis/transitive-impact.js';
import { computeFileRisks, computeHotFiles } from '../analysis/file-risk.js';
import { detectResourceChains } from '../analysis/resource-chains.js';
import { buildProjectIndex } from '../analysis/project-index.js';
import { generateInsights } from '../analysis/insights.js';
import { getVersion } from '../utils/version.js';
import { SCHEMA_VERSION } from '../schema.js';
import type { ScanResult, ScanOptions, ParseResult, ArchRule } from '../types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// SCHEMA_VERSION imported from ../schema.js

/**
 * Main scanner orchestrator.
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
    try {
      const cacheRaw = await readFile(join(root, '.archmap', 'parse-cache.json'), 'utf-8');
      const cachedResults: ParseResult[] = JSON.parse(cacheRaw);
      const changedSet = new Set(changedFiles.map((f) => f.replace(/\\/g, '/')));
      const unchanged = cachedResults.filter((r) => !changedSet.has(r.filePath));
      const changedDiscovered = files.filter((f) => changedSet.has(f.relativePath));
      const freshResults = await parseFiles(changedDiscovered);
      parseResults = [...unchanged, ...freshResults];
    } catch {
      parseResults = await parseFiles(files);
    }
  } else {
    parseResults = await parseFiles(files);
  }

  // 2b. Compute parsing stats (per-file tracking)
  const astCount = parseResults.filter((r) => r.parseMethod === 'ast').length;
  const regexFiles = parseResults.filter((r) => r.parseMethod === 'regex').map((r) => r.filePath);
  const regexCount = regexFiles.length;
  const astPct = parseResults.length > 0 ? Math.round((astCount / parseResults.length) * 100) : 0;

  // 2c. Strict AST mode — fail if any file fell to regex
  if (options.strictAst && regexCount > 0) {
    throw new Error(
      `--strict-ast: ${regexCount} file(s) parsed with regex fallback instead of AST:\n` +
      regexFiles.map((f) => `  - ${f}`).join('\n') +
      '\n\nEnsure tree-sitter-wasms is installed and WASM grammars are available.',
    );
  }

  // 3. Separate production from support code
  const productionResults = parseResults.filter((r) => !r.isSupport);

  // 4. Build project index + dependency graph (production only for architecture)
  const projectIndex = buildProjectIndex(files.filter((f) => !f.isSupport), root);
  const graph = buildDependencyGraph(productionResults, root, projectIndex);

  // 5. Detect modules (production only)
  const modules = detectModules(productionResults, graph, options.config);

  // 5. Infer layers
  const layers = inferLayers(modules);
  graph.layers = layers;

  const moduleGraph = {
    ...graph,
    nodes: [
      ...modules.map((m) => ({ id: m.id, label: m.name, type: 'module' as const })),
      ...graph.nodes.filter((n) => n.type === 'external'),
    ],
  };

  // 6. Analyze git history (optional)
  let contracts: ScanResult['contracts'] = [];
  if (options.gitHistory) {
    try {
      contracts = await analyzeGitHistory(root, options.config);
    } catch { /* optional */ }
  }

  // 7. Load previous rules for trend computation
  let previousRules: ArchRule[] | undefined;
  try {
    const prevPath = join(root, '.archmap', 'rules.json');
    if (existsSync(prevPath)) {
      const prevRaw = JSON.parse(await readFile(prevPath, 'utf-8'));
      previousRules = prevRaw.rules;
    }
  } catch { /* no previous rules */ }

  // 8. Infer rules via multi-signal convergence
  const inferredRules = await inferRules(modules, moduleGraph, productionResults, contracts, options.config, root, previousRules);

  // 9. Load manual rules
  const manualRules = await loadManualRules(root);
  const allRules = [...manualRules, ...inferredRules];

  // 10. File-level analysis (production graph for architecture, all for test mapping)
  const fileGraph = buildDependencyGraph(productionResults, root, projectIndex);
  const transitiveImpact = computeTransitiveImpact(fileGraph);
  const fanInMap = computeFanIn(fileGraph);
  const criticalPaths = findCriticalPaths(fileGraph);
  const changeFreq = new Map<string, number>();

  // Risk scores: compute for all files but force support files to low risk
  const fileRisks = computeFileRisks(parseResults, fileGraph, criticalPaths, transitiveImpact, fanInMap, changeFreq);
  for (const r of fileRisks) {
    if (parseResults.find((p) => p.filePath === r.file)?.isSupport) {
      r.risk = 'low';
      r.score = 0;
    }
  }
  const hotFiles = computeHotFiles(fileRisks.filter((r) => r.score > 0), modules);

  // 11. Detect resource chains (production files for chains)
  const resourceChains = detectResourceChains(productionResults);

  // 12. Generate insights (16 types, deduplicated) — BEFORE health
  const productionFileCount = productionResults.length;
  const insights = generateInsights({
    fileRisks: fileRisks.filter((r) => !parseResults.find((p) => p.filePath === r.file)?.isSupport),
    criticalPaths, modules, graph: fileGraph,
    resourceChains, contracts, totalFiles: productionFileCount,
  });

  // 13. Compute health score (AFTER insights — uses insight penalties)
  const health = computeHealthScore(allRules, modules, insights);

  // Collect unique languages
  const languages = [...new Set(files.map((f) => f.language))];

  // Save caches + previous scan for delta
  try {
    const { writeFile: wf, mkdir } = await import('fs/promises');
    const cacheDir = join(root, '.archmap');
    if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
    await wf(join(cacheDir, 'parse-cache.json'), JSON.stringify(parseResults), 'utf-8');
    // Save current scan as "previous" for next diff
    await wf(join(cacheDir, 'previous-scan.json'), JSON.stringify({
      modules, dependencies: moduleGraph, rules: allRules, fileRisks,
      contracts, stats: { totalFiles: files.length, totalModules: modules.length },
    }), 'utf-8');
    await saveScanCache(root);
  } catch { /* optional */ }

  const scanDuration = Date.now() - startTime;
  const version = getVersion();

  return {
    schemaVersion: SCHEMA_VERSION,
    manifest: {
      version,
      generatedAt: new Date().toISOString(),
      generatedBy: `archmap@${version}`,
      repoRoot: root,
      languages,
      scanDuration,
    },
    stats: {
      totalFiles: files.length,
      totalModules: modules.length,
      totalDependencies: moduleGraph.edges.length,
      totalRules: allRules.length,
      totalContracts: contracts.length,
      totalObservations: allRules.filter((r) => r.tier === 'observation').length,
      totalConventions: allRules.filter((r) => r.tier === 'convention').length,
      totalStrongRules: allRules.filter((r) => r.tier === 'rule').length,
      parsing: { ast: astCount, regex: regexCount, pct: astPct, regexFiles },
    },
    health,
    modules,
    dependencies: moduleGraph,
    rules: allRules,
    contracts,
    parseResults,
    fileRisks,
    criticalPaths,
    hotFiles,
    resourceChains,
    insights,
  };
}
