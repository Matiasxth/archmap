import { basename, dirname } from 'path';
import type { ModuleInfo, DependencyGraph, ParseResult } from '../../types.js';
import type { Signal } from './types.js';

/**
 * Signals derived from static analysis of current code.
 * Covers: unidirectional deps, negative space, stability metrics,
 * export surface, naming patterns, test alignment.
 */
export function collectStaticSignals(
  modules: ModuleInfo[],
  graph: DependencyGraph,
  parseResults: ParseResult[],
  root: string,
): Signal[] {
  const signals: Signal[] = [];

  signals.push(...analyzeDirectionality(modules));
  signals.push(...analyzeNegativeSpace(modules));
  signals.push(...analyzeStability(modules, graph));
  signals.push(...analyzeExportSurface(modules, graph));
  signals.push(...analyzeNamingPatterns(parseResults));
  signals.push(...analyzeTestAlignment(parseResults));

  return signals;
}

// --- Directionality ---

function analyzeDirectionality(modules: ModuleInfo[]): Signal[] {
  const signals: Signal[] = [];

  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const a = modules[i];
      const b = modules[j];
      const aImportsB = a.internalDependencies.includes(b.id);
      const bImportsA = b.internalDependencies.includes(a.id);

      if (aImportsB && !bImportsA) {
        signals.push({
          kind: 'unidirectional',
          scope: [a.id, b.id],
          strength: 0.6,
          description: `${a.name} → ${b.name} is one-directional`,
          context: { modules: [a.id, b.id] },
        });
      }

      if (!aImportsB && !bImportsA && modules.length > 3) {
        signals.push({
          kind: 'no-import',
          scope: [a.id, b.id],
          strength: 0.3, // Weak alone — just means no need yet
          description: `${a.name} and ${b.name} have no imports between them`,
          context: { modules: [a.id, b.id] },
        });
      }
    }
  }

  return signals;
}

// --- Negative Space ---

function analyzeNegativeSpace(modules: ModuleInfo[]): Signal[] {
  const signals: Signal[] = [];
  const moduleIds = modules.map((m) => m.id);

  for (const mod of modules) {
    const importCount = mod.internalDependencies.length;
    const available = moduleIds.filter((id) => id !== mod.id);
    const notImported = available.filter((id) => !mod.internalDependencies.includes(id));

    if (available.length < 3 || importCount < 2) continue;

    const selectivity = importCount / available.length;

    // High selectivity + specific absences = strong signal
    if (selectivity >= 0.5 && notImported.length <= 3) {
      for (const absent of notImported) {
        signals.push({
          kind: 'negative-space',
          scope: [mod.id, absent],
          strength: Math.min(0.9, selectivity),
          description: `${mod.name} imports from ${importCount}/${available.length} modules but NOT from ${modules.find((m) => m.id === absent)?.name}`,
          context: {
            modules: [mod.id, absent],
            importCount,
            absentCount: notImported.length,
            selectivity,
          },
        });
      }
    }
  }

  return signals;
}

// --- Stability Metrics (Robert C. Martin) ---

function analyzeStability(modules: ModuleInfo[], graph: DependencyGraph): Signal[] {
  const signals: Signal[] = [];

  for (const mod of modules) {
    // Fan-out: how many modules this one depends on
    const fanOut = mod.internalDependencies.length;

    // Fan-in: how many modules depend on this one
    const fanIn = modules.filter((m) => m.internalDependencies.includes(mod.id)).length;

    const total = fanIn + fanOut;
    if (total === 0) continue;

    const instability = fanOut / total; // 0 = maximally stable, 1 = maximally unstable

    // High fan-in = stable core, should be protected
    if (fanIn >= 3) {
      signals.push({
        kind: 'high-fan-in',
        scope: [mod.id],
        strength: Math.min(0.9, fanIn / modules.length),
        description: `${mod.name} is depended on by ${fanIn} modules (stable core)`,
        context: { modules: [mod.id], fanIn, fanOut, instability },
      });
    }
  }

  return signals;
}

// --- Export Surface ---

function analyzeExportSurface(modules: ModuleInfo[], graph: DependencyGraph): Signal[] {
  const signals: Signal[] = [];

  for (const mod of modules) {
    const totalExports = mod.publicApi.exports.length;
    if (totalExports === 0) continue;

    // Count which exports are actually used by other modules
    // (simplified: count import references to this module)
    const importingModules = graph.edges.filter((e) =>
      e.target.startsWith(mod.id + '/') || e.target === mod.id,
    );
    const usedSymbols = new Set(importingModules.flatMap((e) => e.references.map((r) => r.symbol)));
    const usedExternally = usedSymbols.size;
    const unusedExports = Math.max(0, totalExports - usedExternally);

    if (totalExports <= 5 && totalExports > 0) {
      signals.push({
        kind: 'narrow-api',
        scope: [mod.id],
        strength: 0.5,
        description: `${mod.name} has a narrow API (${totalExports} exports) suggesting intentional boundary`,
        context: { modules: [mod.id], totalExports, usedExternally, unusedExports, apiNarrowness: totalExports / Math.max(1, mod.files.length * 3) },
      });
    }

    if (unusedExports > totalExports * 0.5 && unusedExports >= 3) {
      signals.push({
        kind: 'unused-exports',
        scope: [mod.id],
        strength: 0.4,
        description: `${mod.name} has ${unusedExports} unused exports out of ${totalExports} — possibly over-exposed API`,
        context: { modules: [mod.id], totalExports, usedExternally, unusedExports },
      });
    }
  }

  return signals;
}

// --- Naming Patterns ---

function analyzeNamingPatterns(parseResults: ParseResult[]): Signal[] {
  const signals: Signal[] = [];
  const dirFiles = new Map<string, string[]>();

  for (const result of parseResults) {
    const dir = dirname(result.filePath);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir)!.push(basename(result.filePath));
  }

  for (const [dir, files] of dirFiles) {
    if (files.length < 3) continue;

    const suffixes = new Map<string, number>();
    for (const file of files) {
      const match = file.match(/\.([a-z]+)\.[a-z]+$/);
      if (match) suffixes.set(match[1], (suffixes.get(match[1]) ?? 0) + 1);
    }

    for (const [suffix, count] of suffixes) {
      const ratio = count / files.length;
      if (ratio >= 0.6 && count >= 2) {
        const exceptions = files.filter((f) => !f.match(new RegExp(`\\.${suffix}\\.[a-z]+$`)));
        signals.push({
          kind: 'naming-pattern',
          scope: [dir],
          strength: ratio * 0.7,
          description: `${count}/${files.length} files in ${dir}/ follow *.${suffix}.* pattern`,
          context: { pattern: `*.${suffix}.*`, matchCount: count, totalCount: files.length, exceptions },
        });
      }
    }
  }

  return signals;
}

// --- Test Alignment ---

function analyzeTestAlignment(parseResults: ParseResult[]): Signal[] {
  const signals: Signal[] = [];
  const dirs = new Set(parseResults.map((r) => dirname(r.filePath)));

  // Look for test directories that mirror source directories
  const testPatterns = ['tests', 'test', '__tests__', 'spec'];
  const srcPatterns = ['src', 'lib', 'app', 'pkg'];

  for (const dir of dirs) {
    const parts = dir.split('/');
    const isTest = parts.some((p) => testPatterns.includes(p));
    if (!isTest) continue;

    // Find the corresponding source module
    const testSubpath = parts.filter((p) => !testPatterns.includes(p)).join('/');
    for (const srcPrefix of srcPatterns) {
      const srcDir = `${srcPrefix}/${testSubpath}`;
      if (dirs.has(srcDir)) {
        signals.push({
          kind: 'test-alignment',
          scope: [srcDir],
          strength: 0.4,
          description: `${srcDir} has a mirrored test directory, confirming module boundary`,
          context: { testDir: dir, sourceDir: srcDir },
        });
      }
    }
  }

  return signals;
}
