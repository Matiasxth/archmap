import type {
  ModuleInfo, DependencyGraph, ArchRule, ParseResult, ImplicitContract,
  RuleTier, RuleTrend, ArchmapConfig,
} from '../types.js';
import { collectStaticSignals } from './signals/static-signals.js';
import { collectHistorySignals } from './signals/history-signals.js';
import { collectConfigSignals } from './signals/config-signals.js';
import { collectCrossStackSignals } from './signals/cross-stack-signals.js';
import { detectArchPattern } from './signals/pattern-detector.js';
import { combineSignals } from './signals/signal-combiner.js';
import type { Signal } from './signals/types.js';

/**
 * Infer architectural rules via multi-signal convergence.
 *
 * Pipeline:
 *   1. Collect signals from static analysis, git history, config files
 *   2. Detect known architectural patterns
 *   3. Combine convergent signals into tiered rules
 *   4. Apply trends from previous scan
 *   5. Apply decay (demote weakening rules)
 *   6. Apply user overrides
 */
export async function inferRules(
  modules: ModuleInfo[],
  graph: DependencyGraph,
  parseResults: ParseResult[],
  contracts: ImplicitContract[],
  config: ArchmapConfig,
  root: string,
  previousRules?: ArchRule[],
): Promise<ArchRule[]> {
  // 1. Collect signals from all sources
  const staticSignals = collectStaticSignals(modules, graph, parseResults, root);
  const historySignals = config.gitHistory
    ? await collectHistorySignals(root, modules, contracts, config).catch(() => [] as Signal[])
    : [];
  const configSignals = await collectConfigSignals(root).catch(() => [] as Signal[]);

  const crossStackSignals = collectCrossStackSignals(parseResults);

  const allSignals = [...staticSignals, ...historySignals, ...configSignals, ...crossStackSignals];

  // 2. Detect architectural patterns
  const { pattern, signals: patternSignals } = detectArchPattern(modules, graph);
  allSignals.push(...patternSignals);

  // 3. Combine signals into rules
  const rules = combineSignals(allSignals, pattern);

  // 4. Compute trends against previous scan
  const withTrends = previousRules
    ? computeTrends(rules, previousRules)
    : rules;

  // 5. Apply decay
  const withDecay = applyDecay(withTrends, previousRules);

  // 6. Apply user overrides
  const withOverrides = applyOverrides(withDecay, config.ruleOverrides);

  return withOverrides;
}

// Keep synchronous version for backward compat with tests that don't pass root
export function inferRulesSync(
  modules: ModuleInfo[],
  graph: DependencyGraph,
  parseResults: ParseResult[],
  contracts: ImplicitContract[],
  config: ArchmapConfig,
): ArchRule[] {
  const staticSignals = collectStaticSignals(modules, graph, parseResults, '.');
  const { pattern, signals: patternSignals } = detectArchPattern(modules, graph);
  const allSignals = [...staticSignals, ...patternSignals];

  // Convert contracts to signals inline
  for (const c of contracts) {
    allSignals.push({
      kind: 'co-change',
      scope: c.entities,
      strength: Math.min(0.85, c.confidence),
      description: c.description,
      context: { coChangeCount: c.occurrences, jaccardCoefficient: c.confidence },
    });
  }

  return combineSignals(allSignals, pattern);
}

// --- Trend Computation ---

function computeTrends(current: ArchRule[], previous: ArchRule[]): ArchRule[] {
  return current.map((rule) => {
    const prev = previous.find((p) =>
      p.category === rule.category && p.scope.sort().join(',') === rule.scope.sort().join(','),
    );

    if (!prev) return { ...rule, trend: 'new' as RuleTrend };

    const delta = rule.confidence - prev.confidence;
    let trend: RuleTrend;
    if (delta > 0.05) trend = 'strengthening';
    else if (delta < -0.2) trend = 'broken';
    else if (delta < -0.05) trend = 'weakening';
    else trend = 'stable';

    return {
      ...rule,
      trend,
      evidence: { ...rule.evidence, firstSeen: prev.evidence.firstSeen || rule.evidence.firstSeen },
    };
  });
}

// --- Decay ---

function applyDecay(rules: ArchRule[], previousRules?: ArchRule[]): ArchRule[] {
  if (!previousRules) return rules;

  return rules.map((rule) => {
    if (rule.trend !== 'broken' && rule.trend !== 'weakening') return rule;

    const prev = previousRules.find((p) =>
      p.category === rule.category && p.scope.sort().join(',') === rule.scope.sort().join(','),
    );

    if (prev && (prev.trend === 'broken' || prev.trend === 'weakening')) {
      const demoted = demoteTier(rule.tier);
      if (demoted !== rule.tier) {
        return { ...rule, tier: demoted, evidence: { ...rule.evidence, promotedFrom: rule.tier } };
      }
    }

    return rule;
  });
}

function demoteTier(tier: RuleTier): RuleTier {
  if (tier === 'rule') return 'convention';
  if (tier === 'convention') return 'observation';
  return 'observation';
}

// --- User Overrides ---

function applyOverrides(rules: ArchRule[], overrides: Record<string, string> | undefined): ArchRule[] {
  if (!overrides || Object.keys(overrides).length === 0) return rules;

  return rules
    .filter((r) => overrides[r.id] !== 'suppress')
    .map((r) => {
      const override = overrides[r.id];
      if (override === 'promote:rule') return { ...r, tier: 'rule' as RuleTier };
      if (override === 'promote:convention') return { ...r, tier: 'convention' as RuleTier };
      return r;
    });
}
