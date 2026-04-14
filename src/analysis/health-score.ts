import type { ArchRule, ModuleInfo, HealthScore, RuleTrend } from '../types.js';
import type { Insight } from './insights.js';

const CATEGORY_WEIGHT: Record<string, number> = {
  boundary: 1.5, layer: 1.3, 'co-change': 1.0, naming: 0.5, ownership: 0.8,
};

/**
 * Compute health score using both rule violations AND insight penalties.
 *
 * Rule penalties (existing):
 *   rule violation: -15 × catWeight × modSize
 *   convention violation: -5 × catWeight × modSize
 *   weakening: -3, broken: -8
 *
 * Insight penalties (new):
 *   bottleneck: -2 each
 *   circular dependency: -5 each
 *   concentration risk: -10
 *   untested high risk: -1 each
 *   god module: -1 each
 */
export function computeHealthScore(
  rules: ArchRule[],
  modules: ModuleInfo[],
  insights: Insight[] = [],
): HealthScore {
  const observations = rules.filter((r) => r.tier === 'observation');
  const conventions = rules.filter((r) => r.tier === 'convention');
  const strongRules = rules.filter((r) => r.tier === 'rule');

  const conventionViolations = conventions.filter((r) => r.evidence.recentViolations > 0);
  const ruleViolations = strongRules.filter((r) => r.evidence.recentViolations > 0);
  const weakening = rules.filter((r) => r.trend === 'weakening');
  const broken = rules.filter((r) => r.trend === 'broken');

  const avgFiles = modules.length > 0
    ? modules.reduce((sum, m) => sum + m.files.length, 0) / modules.length
    : 1;

  let score = 100;

  // Rule/convention violation penalties
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

  // Insight penalties (NEW)
  const bottlenecks = insights.filter((i) => i.metric === 'bottleneck');
  const circularDeps = insights.filter((i) => i.metric === 'circular-dependency');
  const concentration = insights.filter((i) => i.metric === 'concentration-risk');
  const untestedHigh = insights.filter((i) => i.metric === 'untested-high-risk');
  const godModules = insights.filter((i) => i.metric === 'god-module-size' || i.metric === 'god-module-exports');

  score -= bottlenecks.length * 2;
  score -= circularDeps.length * 5;
  score -= concentration.length > 0 ? 10 : 0;
  score -= untestedHigh.length * 1;
  score -= godModules.length * 1;

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
    const modInsights = insights.filter((i) => i.module === mod.id || (i.file && mod.files.includes(i.file)));

    let modScore = 100;
    for (const v of modViolations) {
      const penalty = v.tier === 'rule' ? 15 : v.tier === 'convention' ? 5 : 0;
      modScore -= penalty * (CATEGORY_WEIGHT[v.category] ?? 1.0);
    }
    modScore -= modInsights.filter((i) => i.severity === 'critical').length * 3;
    modScore -= modInsights.filter((i) => i.severity === 'warning').length * 1;
    modScore = Math.max(0, Math.min(100, Math.round(modScore)));

    return { moduleId: mod.id, score: modScore, violations: modViolations.length + modInsights.filter((i) => i.severity === 'critical').length };
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
