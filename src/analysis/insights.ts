import { dirname, basename } from 'path';
import type {
  FileRisk, CriticalPath, ModuleInfo, DependencyGraph,
  ResourceChain, ImplicitContract,
} from '../types.js';
import { findCircularDeps } from './dependency-graph.js';

export interface Insight {
  severity: 'info' | 'warning' | 'critical';
  id: string;
  file?: string;
  module?: string;
  metric: string;
  description: string;
  action: string;
  data: Record<string, number | string | string[]>;
}

interface InsightInput {
  fileRisks: FileRisk[];
  criticalPaths: CriticalPath[];
  modules: ModuleInfo[];
  graph: DependencyGraph;
  resourceChains: ResourceChain[];
  contracts: ImplicitContract[];
  totalFiles: number;
}

export function generateInsights(input: InsightInput): Insight[] {
  const all: Insight[] = [];

  all.push(...i01_singlePointOfFailure(input));
  all.push(...i02_highFanOut(input));
  all.push(...i03_godModule(input));
  all.push(...i04_longChainRisk(input));
  all.push(...i05_bottleneck(input));
  all.push(...i06_untestedHighRisk(input));
  all.push(...i07_circularDependency(input));
  all.push(...i08_deadModule(input));
  all.push(...i09_hubFile(input));
  all.push(...i10_unstableCore(input));
  all.push(...i11_incompleteChain(input));
  all.push(...i12_orphanEndpoint(input));
  all.push(...i13_hotspot(input));
  all.push(...i14_hiddenCoupling(input));
  all.push(...i15_overExposedApi(input));
  all.push(...i16_concentrationRisk(input));

  // Deduplicate: higher-specificity insights subsume lower ones
  const deduped = deduplicate(all);

  // Sort: critical → warning → info
  const order = { critical: 0, warning: 1, info: 2 };
  return deduped.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ============================================================
// #1 Single Point of Failure
// ============================================================

function i01_singlePointOfFailure({ fileRisks, totalFiles }: InsightInput): Insight[] {
  return fileRisks
    .filter((r) => r.fanIn >= 15)
    .map((r, i) => {
      const pct = Math.round((r.transitiveImpact / totalFiles) * 100);
      const severity = r.fanIn >= 40 ? 'critical' as const : r.fanIn >= 25 ? 'warning' as const : 'info' as const;
      return {
        severity, id: `spof-${i}`, file: r.file, metric: 'single-point-of-failure',
        description: `${r.file} is a single point of failure: ${r.fanIn} files depend on it directly, ${r.transitiveImpact} transitively (${pct}% of the project).`,
        action: severity === 'critical'
          ? `Changes here affect ${pct}% of the project. Consider splitting into smaller modules. Any breaking change cascades widely.`
          : `Be careful with changes — ${r.fanIn} direct dependents.`,
        data: { fanIn: r.fanIn, transitiveImpact: r.transitiveImpact, pctAffected: pct },
      };
    });
}

// ============================================================
// #2 High Fan-Out
// ============================================================

function i02_highFanOut({ graph }: InsightInput): Insight[] {
  const fanOut = new Map<string, number>();
  for (const edge of graph.edges) {
    fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
  }

  return [...fanOut.entries()]
    .filter(([file, count]) => count >= 8 && !isTestFile(file))
    .map(([file, count], i) => ({
      severity: count >= 15 ? 'warning' as const : 'info' as const,
      id: `fanout-${i}`, file, metric: 'high-fan-out',
      description: `${file} imports from ${count} other files. Coupled to many modules — changes in any of them can break it.`,
      action: `Consider if all ${count} dependencies are necessary. Extract common dependencies into a facade or reduce coupling.`,
      data: { fanOut: count },
    }));
}

// ============================================================
// #3 God Module
// ============================================================

function i03_godModule({ modules, totalFiles }: InsightInput): Insight[] {
  const insights: Insight[] = [];
  const avgFiles = totalFiles / Math.max(modules.length, 1);

  for (const mod of modules) {
    if (isMigrationDir(mod.id)) continue;

    if (mod.files.length > avgFiles * 3 && mod.files.length >= 15) {
      insights.push({
        severity: 'warning', id: `god-size-${mod.id}`, module: mod.id, metric: 'god-module-size',
        description: `Module ${mod.id} has ${mod.files.length} files (project average: ${Math.round(avgFiles)}). It may be doing too much.`,
        action: `Consider splitting ${mod.id} into smaller, focused modules.`,
        data: { files: mod.files.length, average: Math.round(avgFiles) },
      });
    }

    if (mod.publicApi.exports.length >= 80) {
      insights.push({
        severity: 'warning', id: `god-api-${mod.id}`, module: mod.id, metric: 'god-module-exports',
        description: `Module ${mod.id} exports ${mod.publicApi.exports.length} symbols. The API surface is very large.`,
        action: `Review if all ${mod.publicApi.exports.length} exports need to be public.`,
        data: { exports: mod.publicApi.exports.length },
      });
    } else if (mod.publicApi.exports.length >= 50) {
      insights.push({
        severity: 'info', id: `god-api-${mod.id}`, module: mod.id, metric: 'god-module-exports',
        description: `Module ${mod.id} exports ${mod.publicApi.exports.length} symbols.`,
        action: `Consider if all exports need to be public.`,
        data: { exports: mod.publicApi.exports.length },
      });
    }
  }

  return insights;
}

// ============================================================
// #4 Long Chain Risk
// ============================================================

function i04_longChainRisk({ criticalPaths }: InsightInput): Insight[] {
  return criticalPaths
    .filter((p) => p.length >= 5)
    .map((p, i) => ({
      severity: p.length >= 7 ? 'warning' as const : 'info' as const,
      id: `chain-${i}`, file: p.rootFile, metric: 'long-dependency-chain',
      description: `Dependency chain of ${p.length} files: ${p.rootFile} → ... → ${p.leafFile}. A change at the root cascades through ${p.length - 1} downstream files.`,
      action: `Changes to ${p.rootFile} should be backward-compatible. Consider adding an interface to break the chain.`,
      data: { chainLength: p.length, root: p.rootFile, leaf: p.leafFile },
    }));
}

// ============================================================
// #5 Bottleneck
// ============================================================

function i05_bottleneck({ fileRisks, totalFiles }: InsightInput): Insight[] {
  return fileRisks
    .filter((r) => r.fanIn >= 10 && r.isOnCriticalPath)
    .slice(0, 5)
    .map((r, i) => {
      const pct = Math.round((r.transitiveImpact / totalFiles) * 100);
      return {
        severity: 'critical' as const,
        id: `bottleneck-${i}`, file: r.file, metric: 'bottleneck',
        description: `${r.file} is a bottleneck: ${r.fanIn} dependents AND on a critical dependency chain. Affects ${pct}% of the project.`,
        action: `Highest-risk file to change. Stabilize its API, add comprehensive tests, and minimize changes.`,
        data: { fanIn: r.fanIn, impact: r.transitiveImpact, pctAffected: pct },
      };
    });
}

// ============================================================
// #6 Untested High Risk
// ============================================================

function i06_untestedHighRisk({ fileRisks }: InsightInput): Insight[] {
  return fileRisks
    .filter((r) => (r.risk === 'high' || r.risk === 'critical') && !r.hasTests)
    .map((r, i) => ({
      severity: 'warning' as const,
      id: `untested-${i}`, file: r.file, metric: 'untested-high-risk',
      description: `${r.file} is ${r.risk} risk (fan-in ${r.fanIn}, impact ${r.transitiveImpact}) but has no detected tests.`,
      action: `Add tests for this file. It has ${r.fanIn} dependents — a bug here affects many files.`,
      data: { risk: r.risk, fanIn: r.fanIn, impact: r.transitiveImpact },
    }));
}

// ============================================================
// #7 Circular Dependency
// ============================================================

function i07_circularDependency({ graph }: InsightInput): Insight[] {
  const cycles = findCircularDeps(graph);
  return cycles.slice(0, 5).map((cycle, i) => {
    const len = cycle.length - 1; // last element repeats the first
    const severity = len >= 3 ? 'critical' as const : 'warning' as const;
    return {
      severity, id: `circular-${i}`, file: cycle[0], metric: 'circular-dependency',
      description: len === 2
        ? `Circular dependency: ${cycle[0]} ↔ ${cycle[1]}. They import each other.`
        : `Dependency cycle of ${len} files: ${cycle.join(' → ')}`,
      action: len === 2
        ? `Extract shared functionality to a third file that both import.`
        : `Identify the natural data flow direction and break the cycle by inverting one dependency.`,
      data: { cycleLength: len, files: cycle },
    };
  });
}

// ============================================================
// #8 Dead Module
// ============================================================

function i08_deadModule({ fileRisks, graph }: InsightInput): Insight[] {
  const fanOut = new Map<string, number>();
  for (const edge of graph.edges) {
    fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
  }

  return fileRisks
    .filter((r) => r.fanIn === 0 && (fanOut.get(r.file) ?? 0) <= 1
      && !isEntryPoint(r.file) && !isTestFile(r.file) && !isScript(r.file))
    .map((r, i) => ({
      severity: 'info' as const,
      id: `dead-${i}`, file: r.file, metric: 'dead-module',
      description: `${r.file}: nothing imports it and it has ${fanOut.get(r.file) ?? 0} dependencies. Possibly dead code.`,
      action: `Verify if this file is used by other means (CLI, cron, dynamic import). If not, consider removing it.`,
      data: { fanIn: 0, fanOut: fanOut.get(r.file) ?? 0 },
    }));
}

// ============================================================
// #9 Hub File
// ============================================================

function i09_hubFile({ fileRisks, graph }: InsightInput): Insight[] {
  const fanOut = new Map<string, number>();
  for (const edge of graph.edges) {
    fanOut.set(edge.source, (fanOut.get(edge.source) ?? 0) + 1);
  }

  return fileRisks
    .filter((r) => r.fanIn >= 10 && (fanOut.get(r.file) ?? 0) >= 8)
    .map((r, i) => ({
      severity: 'warning' as const,
      id: `hub-${i}`, file: r.file, metric: 'hub-file',
      description: `${r.file} is a hub: ${r.fanIn} files depend on it AND it depends on ${fanOut.get(r.file)} files. Both fragile and dangerous.`,
      action: `This file has too much responsibility. Split it: extract what others import into a stable module, and move complex dependencies to a separate module.`,
      data: { fanIn: r.fanIn, fanOut: fanOut.get(r.file) ?? 0 },
    }));
}

// ============================================================
// #10 Unstable Core
// ============================================================

function i10_unstableCore({ modules }: InsightInput): Insight[] {
  const modDeps = new Map<string, { fanIn: number; fanOut: number }>();

  for (const mod of modules) {
    const fanOut = mod.internalDependencies.length;
    const fanIn = modules.filter((m) => m.internalDependencies.includes(mod.id)).length;
    modDeps.set(mod.id, { fanIn, fanOut });
  }

  return modules
    .filter((mod) => {
      const d = modDeps.get(mod.id)!;
      const instability = d.fanOut / Math.max(d.fanIn + d.fanOut, 1);
      return d.fanIn >= 3 && instability > 0.5;
    })
    .map((mod, i) => {
      const d = modDeps.get(mod.id)!;
      const instability = (d.fanOut / Math.max(d.fanIn + d.fanOut, 1)).toFixed(2);
      return {
        severity: 'warning' as const,
        id: `unstable-core-${i}`, module: mod.id, metric: 'unstable-core',
        description: `Module ${mod.id} has ${d.fanIn} dependents but instability ${instability}. A module with many dependents should be stable (instability < 0.3). It depends on ${d.fanOut} other modules, making it vulnerable.`,
        action: `Reduce dependencies of ${mod.id} or move dependent logic to a separate module. Core modules should depend on abstractions.`,
        data: { fanIn: d.fanIn, fanOut: d.fanOut, instability },
      };
    });
}

// ============================================================
// #11 Incomplete Chain
// ============================================================

function i11_incompleteChain({ resourceChains }: InsightInput): Insight[] {
  const insights: Insight[] = [];

  for (const chain of resourceChains) {
    const roles = new Set(chain.links.map((l) => l.role));

    if (roles.has('model') && !roles.has('schema')) {
      insights.push({
        severity: 'info', id: `incomplete-schema-${chain.resource}`, metric: 'incomplete-chain',
        description: `Resource '${chain.resource}' has a model but no schema/DTO. Data validation may be missing.`,
        action: `Consider adding a schema for ${chain.resource} to validate data between model and consumers.`,
        data: { resource: chain.resource, present: [...roles], missing: 'schema' },
      });
    }

    if (roles.has('api') && chain.isCrossStack && !roles.has('hook') && !roles.has('store') && !roles.has('page')) {
      insights.push({
        severity: 'warning', id: `incomplete-consumer-${chain.resource}`, metric: 'incomplete-chain',
        description: `Resource '${chain.resource}' has a backend API but no frontend consumer detected (no hook, store, or page).`,
        action: `The API for ${chain.resource} may be consumed externally, or the frontend consumer has a different name.`,
        data: { resource: chain.resource, present: [...roles], missing: 'frontend consumer' },
      });
    }

    if (roles.has('model') && roles.has('api') && !roles.has('service')) {
      insights.push({
        severity: 'info', id: `incomplete-service-${chain.resource}`, metric: 'incomplete-chain',
        description: `Resource '${chain.resource}' has model and API but no service layer. API may access model directly.`,
        action: `Consider adding a service layer to separate business logic from the API endpoint.`,
        data: { resource: chain.resource, present: [...roles], missing: 'service' },
      });
    }
  }

  return insights;
}

// ============================================================
// #12 Orphan Endpoint
// ============================================================

function i12_orphanEndpoint({ fileRisks, resourceChains }: InsightInput): Insight[] {
  const chainFiles = new Set(resourceChains.flatMap((c) => c.links.map((l) => l.file)));

  return fileRisks
    .filter((r) => r.fanIn === 0 && isApiFile(r.file) && !chainFiles.has(r.file))
    .map((r, i) => ({
      severity: 'info' as const,
      id: `orphan-${i}`, file: r.file, metric: 'orphan-endpoint',
      description: `${r.file} is an endpoint with no detected consumers in the project.`,
      action: `Verify if this endpoint is consumed externally (mobile app, API client). If not, consider removing it.`,
      data: { fanIn: 0 },
    }));
}

// ============================================================
// #13 Hotspot
// ============================================================

function i13_hotspot({ fileRisks }: InsightInput): Insight[] {
  return fileRisks
    .filter((r) => r.changeFrequency > 0.2 && r.fanIn >= 5 && !isConfigFile(r.file))
    .map((r, i) => {
      const pct = Math.round(r.changeFrequency * 100);
      return {
        severity: r.changeFrequency > 0.3 && r.fanIn >= 10 ? 'warning' as const : 'info' as const,
        id: `hotspot-${i}`, file: r.file, metric: 'hotspot',
        description: `${r.file} is a hotspot: changes in ${pct}% of commits AND has ${r.fanIn} dependents. High probability × high impact = maximum bug risk.`,
        action: `Stabilize this file's API. If it needs frequent changes, reduce its dependents or add tests covering the most-used paths.`,
        data: { changeFrequency: pct, fanIn: r.fanIn },
      };
    });
}

// ============================================================
// #14 Hidden Coupling
// ============================================================

function i14_hiddenCoupling({ contracts, graph, resourceChains }: InsightInput): Insight[] {
  const chainPairs = new Set<string>();
  for (const chain of resourceChains) {
    for (let i = 0; i < chain.links.length; i++) {
      for (let j = i + 1; j < chain.links.length; j++) {
        chainPairs.add([chain.links[i].file, chain.links[j].file].sort().join('|'));
      }
    }
  }

  const edgeSet = new Set(graph.edges.map((e) => [e.source, e.target].sort().join('|')));

  return contracts
    .filter((c) => c.confidence >= 0.75)
    .filter((c) => {
      const key = [...c.entities].sort().join('|');
      return !edgeSet.has(key) && !chainPairs.has(key);
    })
    .slice(0, 10)
    .map((c, i) => ({
      severity: c.confidence >= 0.90 ? 'warning' as const : 'info' as const,
      id: `hidden-${i}`, metric: 'hidden-coupling',
      description: `${c.entities[0]} and ${c.entities[1]} co-change ${Math.round(c.confidence * 100)}% of the time but have no direct import relationship. Implicit coupling.`,
      action: `Investigate why these files change together. Shared data contract? Missing shared dependency? Accidental coupling?`,
      data: { fileA: c.entities[0], fileB: c.entities[1], confidence: Math.round(c.confidence * 100), coChanges: c.occurrences },
    }));
}

// ============================================================
// #15 Over-Exposed API
// ============================================================

function i15_overExposedApi({ modules, graph }: InsightInput): Insight[] {
  return modules
    .filter((mod) => {
      if (isLibraryModule(mod.id)) return false;
      const total = mod.publicApi.exports.length;
      if (total < 10) return false;

      const usedSymbols = new Set<string>();
      for (const edge of graph.edges) {
        if (edge.target.startsWith(mod.path + '/') || edge.target === mod.path) {
          for (const ref of edge.references) usedSymbols.add(ref.symbol);
        }
      }
      const unused = total - usedSymbols.size;
      return unused > total * 0.5 && unused >= 10;
    })
    .map((mod, i) => {
      const total = mod.publicApi.exports.length;
      const usedSymbols = new Set<string>();
      for (const edge of graph.edges) {
        if (edge.target.startsWith(mod.path + '/') || edge.target === mod.path) {
          for (const ref of edge.references) usedSymbols.add(ref.symbol);
        }
      }
      const used = usedSymbols.size;
      const unused = total - used;
      const severity = unused > total * 0.7 && unused >= 20 ? 'warning' as const : 'info' as const;
      return {
        severity, id: `overexposed-${i}`, module: mod.id, metric: 'over-exposed-api',
        description: `Module ${mod.id} exports ${total} symbols but only ${used} are used externally. ${unused} exports have no consumers (${Math.round(unused / total * 100)}% unused).`,
        action: `Review if the ${unused} unused exports need to be public. Reduce API surface for clarity.`,
        data: { totalExports: total, usedExternally: used, unusedExports: unused },
      };
    });
}

// ============================================================
// #16 Concentration Risk
// ============================================================

function i16_concentrationRisk({ fileRisks, totalFiles }: InsightInput): Insight[] {
  if (totalFiles < 20) return [];

  const sorted = [...fileRisks].sort((a, b) => b.fanIn - a.fanIn);
  const totalFanIn = fileRisks.reduce((sum, r) => sum + r.fanIn, 0);
  if (totalFanIn === 0) return [];

  const top3 = sorted.slice(0, 3);
  const top3FanIn = top3.reduce((sum, r) => sum + r.fanIn, 0);
  const concentration = top3FanIn / totalFanIn;

  if (concentration < 0.50) return [];

  const severity = concentration > 0.70 ? 'critical' as const : 'warning' as const;
  const pct = Math.round(concentration * 100);
  const names = top3.map((r) => `${r.file} (${r.fanIn})`).join(', ');

  return [{
    severity, id: 'concentration-0', metric: 'concentration-risk',
    description: `Concentration risk: ${names} hold ${pct}% of all dependencies. If any fails, most of the project is affected.`,
    action: `Distribute responsibility. Extract functionality from top files into specialized modules. Ensure these files have exhaustive test coverage.`,
    data: { concentration: pct, top3: top3.map((r) => r.file), top3FanIn },
  }];
}

// ============================================================
// Deduplication
// ============================================================

function deduplicate(insights: Insight[]): Insight[] {
  const bottleneckFiles = new Set(insights.filter((i) => i.metric === 'bottleneck').map((i) => i.file));
  const hubFiles = new Set(insights.filter((i) => i.metric === 'hub-file').map((i) => i.file));

  return insights.filter((insight) => {
    // Bottleneck subsumes single-point-of-failure for same file
    if (insight.metric === 'single-point-of-failure' && insight.file && bottleneckFiles.has(insight.file)) return false;
    // Hub subsumes both high-fan-out and single-point-of-failure for same file
    if (insight.metric === 'high-fan-out' && insight.file && hubFiles.has(insight.file)) return false;
    if (insight.metric === 'single-point-of-failure' && insight.file && hubFiles.has(insight.file)) return false;
    return true;
  });
}

// ============================================================
// Helpers
// ============================================================

function isTestFile(f: string): boolean {
  const b = basename(f);
  return /\.(test|spec)\.[^.]+$|_test\.[^.]+$|^test_/.test(b) || f.includes('__tests__/') || f.includes('/test/') || f.includes('/tests/');
}

function isEntryPoint(f: string): boolean {
  const b = basename(f).replace(/\.[^.]+$/, '').toLowerCase();
  return ['main', 'index', 'app', '__main__', '__init__', 'setup', 'conftest', 'mod'].includes(b);
}

function isScript(f: string): boolean {
  return f.includes('/scripts/') || f.includes('/bin/') || f.includes('/cmd/');
}

function isApiFile(f: string): boolean {
  return /\/(api|routes|controllers|handlers)\//.test(f);
}

function isConfigFile(f: string): boolean {
  const b = basename(f).toLowerCase();
  return b.includes('config') || b.includes('settings') || b.includes('env');
}

function isMigrationDir(id: string): boolean {
  return id.includes('migration') || id.includes('alembic') || id.includes('versions');
}

function isLibraryModule(id: string): boolean {
  return id.includes('sdk/') || id.includes('lib/') || id.includes('packages/');
}
