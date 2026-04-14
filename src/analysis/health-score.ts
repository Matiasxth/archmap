import type { ArchRule, ModuleInfo, HealthScore, RuleTrend } from '../types.js';

/**
 * Compute aggregate health score weighted by severity and module size.
 *
 * Scoring (start at 100):
 *   Rule violation:       -15 × (module_files / avg_files) — weighted by module size
 *   Convention violation:  -5 × (module_files / avg_files)
 *   Weakening trend:       -3 (structural drift)
 *   Broken trend:          -8 (active degradation)
 *   Unstable hotspot:      -5 (risk multiplier)
 *
 * Category weights:
 *   boundary:  1.5x (hardest to fix)
 *   layer:     1.3x
 *   co-change: 1.0x
 *   naming:    0.5x (cosmetic)
 */
const CATEGORY_WEIGHT: Record<string, number> = {
  boundary: 1.5,
  layer: 1.3,
  'co-change': 1.0,
  naming: 0.5,
  ownership: 0.8,
};

export function computeHealthScore(rules: ArchRule[], modules: ModuleInfo[]): HealthScore {
  const observations = rules.filter((r) => r.tier === 'observation');
  const conventions = rules.filter((r) => r.tier === 'convention');
  const strongRules = rules.filter((r) => r.tier === 'rule');

  const conventionViolations = conventions.filter((r) => r.evidence.recentViolations > 0);
  const ruleViolations = strongRules.filter((r) => r.evidence.recentViolations > 0);
  const weakening = rules.filter((r) => r.trend === 'weakening');
  const broken = rules.filter((r) => r.trend === 'broken');
  const hotspots = rules.filter((r) =>
    r.evidence.details && (r.evidence.details as any).signalKinds?.includes?.('unstable-hotspot'),
  );

  const avgFiles = modules.length > 0
    ? modules.reduce((sum, m) => sum + m.files.length, 0) / modules.length
    : 1;

  let score = 100;

  // Weighted rule violations
  for (const v of ruleViolations) {
    const catWeight = CATEGORY_WEIGHT[v.category] ?? 1.0;
    const modSize = getModuleSize(v.scope, modules) / Math.max(1, avgFiles);
    score -= 15 * catWeight * Math.max(0.5, modSize);
  }

  for (const v of conventionViolations) {
    const catWeight = CATEGORY_WEIGHT[v.category] ?? 1.0;
    const modSize = getModuleSize(v.scope, modules) / Math.max(1, avgFiles);
    score -= 5 * catWeight * Math.max(0.5, modSize);
  }

  // Drift penalties
  score -= weakening.length * 3;
  score -= broken.length * 8;
  score -= hotspots.length * 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Overall trend
  let trend: RuleTrend = 'stable';
  if (broken.length > 0) trend = 'broken';
  else if (weakening.length > rules.length * 0.2) trend = 'weakening';
  else if (rules.filter((r) => r.trend === 'strengthening').length > rules.length * 0.2) trend = 'strengthening';

  // Per-module scores
  const moduleScores = modules.map((mod) => {
    const modRules = rules.filter((r) => r.scope.some((s) => s === mod.id || s === '*'));
    const modViolations = modRules.filter((r) => r.evidence.recentViolations > 0);

    let modScore = 100;
    for (const v of modViolations) {
      const catWeight = CATEGORY_WEIGHT[v.category] ?? 1.0;
      const penalty = v.tier === 'rule' ? 15 : v.tier === 'convention' ? 5 : 0;
      modScore -= penalty * catWeight;
    }
    modScore -= modRules.filter((r) => r.trend === 'broken').length * 8;
    modScore = Math.max(0, Math.min(100, Math.round(modScore)));

    return { moduleId: mod.id, score: modScore, violations: modViolations.length };
  });

  return {
    overall: score,
    trend,
    breakdown: {
      observations: { total: observations.length },
      conventions: { total: conventions.length, violations: conventionViolations.length },
      rules: { total: strongRules.length, violations: ruleViolations.length },
    },
    moduleScores,
  };
}

function getModuleSize(scope: string[], modules: ModuleInfo[]): number {
  for (const s of scope) {
    const mod = modules.find((m) => m.id === s);
    if (mod) return mod.files.length;
  }
  return 1;
}
