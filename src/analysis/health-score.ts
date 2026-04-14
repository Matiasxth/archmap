import type { ArchRule, ModuleInfo, HealthScore, RuleTrend } from '../types.js';

/**
 * Compute aggregate health score for the project.
 *
 * Scoring:
 *   Start at 100.
 *   - Each rule violation:      -15 points
 *   - Each convention violation: -5 points
 *   - Each weakening trend:      -2 points
 *   - Each broken trend:         -5 points
 *   Minimum: 0
 */
export function computeHealthScore(rules: ArchRule[], modules: ModuleInfo[]): HealthScore {
  const observations = rules.filter((r) => r.tier === 'observation');
  const conventions = rules.filter((r) => r.tier === 'convention');
  const strongRules = rules.filter((r) => r.tier === 'rule');

  const conventionViolations = conventions.filter((r) => r.evidence.recentViolations > 0);
  const ruleViolations = strongRules.filter((r) => r.evidence.recentViolations > 0);
  const weakening = rules.filter((r) => r.trend === 'weakening');
  const broken = rules.filter((r) => r.trend === 'broken');

  let score = 100;
  score -= ruleViolations.length * 15;
  score -= conventionViolations.length * 5;
  score -= weakening.length * 2;
  score -= broken.length * 5;
  score = Math.max(0, Math.min(100, score));

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
    modScore -= modViolations.filter((r) => r.tier === 'rule').length * 15;
    modScore -= modViolations.filter((r) => r.tier === 'convention').length * 5;
    modScore = Math.max(0, Math.min(100, modScore));

    return {
      moduleId: mod.id,
      score: modScore,
      violations: modViolations.length,
    };
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
