import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scanProject } from '../src/scanner/index.js';
import { generateMarkdown } from '../src/output/markdown-generator.js';
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

describe('Integration: Full Scan', () => {
  it('scans sample project and produces correct stats', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    // Should find all .ts files in fixture
    expect(result.stats.totalFiles).toBeGreaterThanOrEqual(10);

    // Should detect modules: auth, db, routes, models, utils
    const moduleNames = result.modules.map((m) => m.name);
    expect(moduleNames).toContain('auth');
    expect(moduleNames).toContain('db');
    expect(moduleNames).toContain('routes');
    expect(moduleNames).toContain('utils');
  });

  it('detects cross-module dependencies', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    // auth depends on db and utils
    const authModule = result.modules.find((m) => m.name === 'auth');
    expect(authModule).toBeDefined();
    expect(authModule!.internalDependencies).toContain('src/db');
    expect(authModule!.internalDependencies).toContain('src/utils');

    // routes depends on auth and db
    const routesModule = result.modules.find((m) => m.name === 'routes');
    expect(routesModule).toBeDefined();
    expect(routesModule!.internalDependencies).toContain('src/auth');
    expect(routesModule!.internalDependencies).toContain('src/db');
  });

  it('detects public API exports', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    const authModule = result.modules.find((m) => m.name === 'auth');
    const exportNames = authModule!.publicApi.exports.map((e) => e.name);
    expect(exportNames).toContain('authenticate');
    expect(exportNames).toContain('verifyToken');
    expect(exportNames).toContain('signToken');
  });

  it('generates valid markdown', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    const md = generateMarkdown(result);
    expect(md).toContain('# Architecture Map');
    expect(md).toContain('## Modules');
    expect(md).toContain('## For AI Agents');
    expect(md).toContain('`src/auth`');
    expect(md).toContain('`src/db`');
  });

  it('infers architectural rules', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    expect(result.rules.length).toBeGreaterThan(0);
    // Should infer that models doesn't import from routes (boundary)
    const hasBoundaryRule = result.rules.some((r) => r.category === 'boundary');
    expect(hasBoundaryRule).toBe(true);
  });

  it('produces valid manifest', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: DEFAULT_CONFIG,
    });

    expect(result.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.manifest.generatedBy).toContain('archmap');
    expect(result.manifest.languages).toContain('typescript');
    expect(result.manifest.scanDuration).toBeGreaterThan(0);
  });
});
