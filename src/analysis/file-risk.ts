import { basename, dirname, join } from 'path';
import type { DependencyGraph, ParseResult, FileRisk, CriticalPath, HotFile, ModuleInfo } from '../types.js';

/**
 * Compute per-file risk score.
 *
 * risk = (transitiveImpact × 3) + (fanIn × 2) + (changeFreq × 20)
 *      + (isOnCriticalPath ? 15 : 0) - (hasTests ? 10 : 0)
 *
 * Normalized to 0-100. Thresholds: <25=low, <50=medium, <75=high, >=75=critical
 */
export function computeFileRisks(
  parseResults: ParseResult[],
  graph: DependencyGraph,
  criticalPaths: CriticalPath[],
  transitiveImpact: Map<string, number>,
  fanIn: Map<string, number>,
  changeFrequency: Map<string, number>,
): FileRisk[] {
  const criticalFiles = new Set(criticalPaths.flatMap((p) => p.files));
  const testMap = detectTestFiles(parseResults);

  const risks: FileRisk[] = [];
  const rawScores: number[] = [];

  for (const result of parseResults) {
    const file = result.filePath;
    const impact = transitiveImpact.get(file) ?? 0;
    const fi = fanIn.get(file) ?? 0;
    const freq = changeFrequency.get(file) ?? 0;
    const onCritical = criticalFiles.has(file);
    const tests = testMap.get(file) ?? [];
    const hasTests = tests.length > 0;

    const raw = (impact * 3) + (fi * 2) + (freq * 20) + (onCritical ? 15 : 0) - (hasTests ? 10 : 0);
    rawScores.push(raw);

    risks.push({
      file,
      risk: 'low', // will normalize below
      score: raw,
      transitiveImpact: impact,
      fanIn: fi,
      changeFrequency: freq,
      isOnCriticalPath: onCritical,
      hasTests,
      testFiles: tests,
    });
  }

  // Normalize scores to 0-100
  const maxRaw = Math.max(...rawScores, 1);
  for (const r of risks) {
    r.score = Math.round((r.score / maxRaw) * 100);
    r.score = Math.max(0, Math.min(100, r.score));
    r.risk = r.score >= 75 ? 'critical' : r.score >= 50 ? 'high' : r.score >= 25 ? 'medium' : 'low';
  }

  return risks.sort((a, b) => b.score - a.score);
}

/**
 * Detect test files and map them to source files.
 *
 * Heuristics:
 *   src/auth/middleware.ts → tests/auth/middleware.test.ts
 *   app/services/user.py  → tests/test_user.py
 *   pkg/auth/auth.go      → pkg/auth/auth_test.go
 */
export function detectTestFiles(parseResults: ParseResult[]): Map<string, string[]> {
  const allFiles = parseResults.map((r) => r.filePath);
  const testPatterns = /\.(test|spec)\.[^.]+$|_test\.[^.]+$|^test_|__tests__/;
  const testFiles = allFiles.filter((f) => testPatterns.test(basename(f)) || f.includes('__tests__/') || f.includes('/test/') || f.includes('/tests/'));
  const sourceFiles = allFiles.filter((f) => !testFiles.includes(f));

  const mapping = new Map<string, string[]>();

  for (const src of sourceFiles) {
    const srcBase = basename(src).replace(/\.[^.]+$/, ''); // "middleware"
    const srcDir = dirname(src);
    const matches: string[] = [];

    for (const test of testFiles) {
      const testBase = basename(test)
        .replace(/\.(test|spec)\.[^.]+$/, '')
        .replace(/_test\.[^.]+$/, '')
        .replace(/^test_/, '')
        .replace(/\.[^.]+$/, '');

      if (testBase === srcBase) {
        matches.push(test);
      }
    }

    if (matches.length > 0) {
      mapping.set(src, matches);
    }
  }

  return mapping;
}

/**
 * Compute hot files: the most important files in the project.
 * importance = (fanIn × 2) + transitiveImpact + (changeFrequency × 10)
 */
export function computeHotFiles(
  fileRisks: FileRisk[],
  modules: ModuleInfo[],
  maxFiles: number = 15,
): HotFile[] {
  return fileRisks
    .map((r) => {
      const mod = modules.find((m) => m.files.includes(r.file));
      return {
        file: r.file,
        importance: (r.fanIn * 2) + r.transitiveImpact + (r.changeFrequency * 10),
        risk: r.risk,
        fanIn: r.fanIn,
        transitiveImpact: r.transitiveImpact,
        module: mod?.id ?? 'unknown',
      };
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, maxFiles);
}
