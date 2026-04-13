import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scanProject } from '../src/scanner/index.js';
import { generateMarkdown } from '../src/output/markdown-generator.js';
import type { ArchmapConfig } from '../src/types.js';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'python-project');

const PYTHON_CONFIG: ArchmapConfig = {
  version: 1,
  exclude: ['node_modules', 'dist', '.git', '__pycache__', '.venv'],
  include: [],
  moduleDetection: 'directory',
  moduleRoots: ['app'],
  languages: ['python'],
  gitHistory: { maxCommits: 100, minCoChangeConfidence: 0.7 },
  agentIntegration: { updateClaudeMd: false, updateCursorRules: false, summaryPath: '.archmap/SUMMARY.md' },
};

describe('Integration: Python Project', () => {
  it('scans Python project and finds modules', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: PYTHON_CONFIG,
    });

    expect(result.stats.totalFiles).toBeGreaterThanOrEqual(9);

    const moduleNames = result.modules.map((m) => m.name);
    expect(moduleNames).toContain('auth');
    expect(moduleNames).toContain('models');
    expect(moduleNames).toContain('services');
    expect(moduleNames).toContain('utils');
  });

  it('detects Python dependencies', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: PYTHON_CONFIG,
    });

    // All modules should have python language
    for (const mod of result.modules) {
      expect(mod.language).toBe('python');
    }

    // There should be dependencies detected
    expect(result.stats.totalDependencies).toBeGreaterThan(0);
  });

  it('detects Python public APIs', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: PYTHON_CONFIG,
    });

    const utilsModule = result.modules.find((m) => m.name === 'utils');
    expect(utilsModule).toBeDefined();
    const exportNames = utilsModule!.publicApi.exports.map((e) => e.name);
    expect(exportNames).toContain('get_config');
  });

  it('generates valid markdown for Python project', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: PYTHON_CONFIG,
    });

    const md = generateMarkdown(result);
    expect(md).toContain('python');
    expect(md).toContain('`app/auth`');
  });
});
