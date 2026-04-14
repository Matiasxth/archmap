import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scanProject } from '../src/scanner/index.js';
import { computeHealthScore } from '../src/analysis/health-score.js';
import { migrateRulesV1toV2 } from '../src/analysis/schema-migration.js';
import type { ArchmapConfig, ArchRule } from '../src/types.js';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'sample-project');

const CONFIG: ArchmapConfig = {
  version: 1,
  exclude: ['node_modules', 'dist', '.git'],
  include: [],
  moduleDetection: 'directory',
  moduleRoots: ['src'],
  languages: ['typescript', 'javascript'],
  gitHistory: { maxCommits: 100, minCoChangeConfidence: 0.7, trendWindow: 100 },
  agentIntegration: { updateClaudeMd: false, updateCursorRules: false, summaryPath: '.archmap/SUMMARY.md' },
  ruleOverrides: {},
};

describe('Semantic Rules System', () => {
  describe('tiers', () => {
    it('assigns tiers to all rules', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      for (const rule of result.rules) {
        expect(['observation', 'convention', 'rule']).toContain(rule.tier);
      }
    });

    it('assigns categories to all rules', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      for (const rule of result.rules) {
        expect(['boundary', 'co-change', 'naming', 'layer', 'ownership']).toContain(rule.category);
      }
    });

    it('all rules have action strings', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      for (const rule of result.rules) {
        expect(rule.action).toBeTruthy();
        expect(rule.action.length).toBeGreaterThan(10);
      }
    });

    it('all rules have evidence', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      for (const rule of result.rules) {
        expect(rule.evidence).toBeDefined();
        expect(rule.evidence.firstSeen).toBeTruthy();
        expect(rule.evidence.commitsSampled).toBeGreaterThanOrEqual(0);
      }
    });

    it('all rules have scope', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      for (const rule of result.rules) {
        expect(rule.scope).toBeDefined();
        expect(rule.scope.length).toBeGreaterThan(0);
      }
    });

    it('all rules have trend', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      for (const rule of result.rules) {
        expect(['stable', 'strengthening', 'weakening', 'broken', 'new']).toContain(rule.trend);
      }
    });
  });

  describe('stats', () => {
    it('reports tier counts in stats', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      expect(result.stats.totalObservations).toBeGreaterThanOrEqual(0);
      expect(result.stats.totalConventions).toBeGreaterThanOrEqual(0);
      expect(result.stats.totalStrongRules).toBeGreaterThanOrEqual(0);
      expect(result.stats.totalObservations + result.stats.totalConventions + result.stats.totalStrongRules).toBe(result.stats.totalRules);
    });

    it('includes schemaVersion 2', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      expect(result.schemaVersion).toBe(2);
    });
  });

  describe('health score', () => {
    it('computes overall score 0-100', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      expect(result.health.overall).toBeGreaterThanOrEqual(0);
      expect(result.health.overall).toBeLessThanOrEqual(100);
    });

    it('has breakdown by tier', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      expect(result.health.breakdown.observations).toBeDefined();
      expect(result.health.breakdown.conventions).toBeDefined();
      expect(result.health.breakdown.rules).toBeDefined();
    });

    it('has per-module scores', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      expect(result.health.moduleScores.length).toBeGreaterThan(0);
      for (const ms of result.health.moduleScores) {
        expect(ms.score).toBeGreaterThanOrEqual(0);
        expect(ms.score).toBeLessThanOrEqual(100);
        expect(ms.moduleId).toBeTruthy();
      }
    });

    it('clean project has high health score', async () => {
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: CONFIG });
      expect(result.health.overall).toBeGreaterThanOrEqual(80);
    });
  });

  describe('schema migration', () => {
    it('migrates v1 rules to v2', () => {
      const v1Rules = [
        { id: 'rule-001', type: 'boundary', confidence: 0.95, description: 'Test boundary', source: 'static-analysis', evidence: { from: 'a', to: 'b' } },
        { id: 'rule-002', type: 'co-change', confidence: 0.70, description: 'Test co-change', source: 'git-history', evidence: {} },
        { id: 'rule-003', type: 'naming-convention', confidence: 0.88, description: 'Test naming', source: 'static-analysis', evidence: { directory: 'src/routes' } },
      ];

      const migrated = migrateRulesV1toV2(v1Rules);

      expect(migrated).toHaveLength(3);
      // High confidence boundary → rule
      expect(migrated[0].tier).toBe('rule');
      expect(migrated[0].category).toBe('boundary');
      // Medium confidence → observation
      expect(migrated[1].tier).toBe('observation');
      expect(migrated[1].category).toBe('co-change');
      // 88% → convention
      expect(migrated[2].tier).toBe('convention');
      expect(migrated[2].category).toBe('naming');

      // All should have v2 fields
      for (const rule of migrated) {
        expect(rule.action).toBeTruthy();
        expect(rule.evidence.firstSeen).toBeTruthy();
        expect(rule.scope.length).toBeGreaterThan(0);
        expect(rule.trend).toBe('stable');
      }
    });

    it('passes through v2 rules unchanged', () => {
      const v2Rule: ArchRule = {
        id: 'boundary-001', category: 'boundary', tier: 'rule',
        confidence: 0.99, trend: 'stable', scope: ['src/a', 'src/b'],
        description: 'Already v2', action: 'Do not violate',
        source: 'static-analysis',
        evidence: { firstSeen: '2026-01-01', commitsSampled: 100, recentViolations: 0, totalInstances: 100, matchingInstances: 99 },
      };

      const migrated = migrateRulesV1toV2([v2Rule]);
      expect(migrated[0]).toEqual(v2Rule);
    });
  });

  describe('overrides', () => {
    it('suppress removes rules', async () => {
      const configWithSuppress = { ...CONFIG, ruleOverrides: { 'boundary-001': 'suppress' as const } };
      const result = await scanProject(FIXTURE_ROOT, { gitHistory: false, verbose: false, config: configWithSuppress });
      const suppressed = result.rules.find((r) => r.id === 'boundary-001');
      expect(suppressed).toBeUndefined();
    });
  });
});
