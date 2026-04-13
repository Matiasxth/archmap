import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scanProject } from '../src/scanner/index.js';
import { findCircularDeps, buildDependencyGraph } from '../src/analysis/dependency-graph.js';
import type { ArchmapConfig } from '../src/types.js';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'sample-project');

const DEFAULT_CONFIG: ArchmapConfig = {
  version: 1,
  exclude: ['node_modules', 'dist', '.git'],
  include: [],
  moduleDetection: 'directory',
  moduleRoots: ['src'],
  languages: ['typescript', 'javascript'],
  gitHistory: { maxCommits: 100, minCoChangeConfidence: 0.7 },
  agentIntegration: { updateClaudeMd: false, updateCursorRules: false, summaryPath: '.archmap/SUMMARY.md' },
};

describe('CI Mode', () => {
  it('detects no circular deps in clean fixture', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    const graph = buildDependencyGraph(result.parseResults, FIXTURE_ROOT);
    const cycles = findCircularDeps(graph);
    expect(cycles).toHaveLength(0);
  });

  it('infers rules on clean project', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    expect(result.rules.length).toBeGreaterThan(0);
    // All rules should have required fields
    for (const rule of result.rules) {
      expect(rule.id).toBeDefined();
      expect(rule.type).toBeDefined();
      expect(rule.confidence).toBeGreaterThanOrEqual(0);
      expect(rule.confidence).toBeLessThanOrEqual(1);
      expect(rule.description).toBeTruthy();
    }
  });

  it('scan result has all required fields for CI output', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    expect(result.stats).toBeDefined();
    expect(result.stats.totalFiles).toBeGreaterThan(0);
    expect(result.stats.totalModules).toBeGreaterThan(0);
    expect(result.modules).toBeDefined();
    expect(result.rules).toBeDefined();
    expect(result.contracts).toBeDefined();
  });
});
