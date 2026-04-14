import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scanProject } from '../src/scanner/index.js';
import type { ArchmapConfig } from '../src/types.js';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'go-project');

const GO_CONFIG: ArchmapConfig = {
  version: 1,
  exclude: ['node_modules', 'vendor', '.git'],
  include: [],
  moduleDetection: 'directory',
  moduleRoots: ['cmd', 'pkg'],
  languages: ['go'],
  gitHistory: { maxCommits: 100, minCoChangeConfidence: 0.7 },
  agentIntegration: { updateClaudeMd: false, updateCursorRules: false, summaryPath: '.archmap/SUMMARY.md' },
};

describe('Integration: Go Project', () => {
  it('scans Go project and finds modules', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: GO_CONFIG,
    });

    expect(result.stats.totalFiles).toBe(4);

    const moduleNames = result.modules.map((m) => m.name);
    expect(moduleNames).toContain('auth');
    expect(moduleNames).toContain('db');
    expect(moduleNames).toContain('handlers');
  });

  it('detects exported Go symbols', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: GO_CONFIG,
    });

    const authModule = result.modules.find((m) => m.name === 'auth');
    expect(authModule).toBeDefined();
    const exportNames = authModule!.publicApi.exports.map((e) => e.name);
    expect(exportNames).toContain('Token');
    expect(exportNames).toContain('Verify');
    expect(exportNames).toContain('Sign');
    expect(exportNames).toContain('Secret');
    // Should NOT contain unexported 'internalHelper'
    expect(exportNames).not.toContain('internalHelper');
  });

  it('all modules have go language', async () => {
    const result = await scanProject(FIXTURE_ROOT, {
      gitHistory: false,
      verbose: false,
      config: GO_CONFIG,
    });

    for (const mod of result.modules) {
      expect(mod.language).toBe('go');
    }
  });
});
