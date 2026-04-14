import { basename, dirname } from 'path';
import type {
  ModuleInfo, DependencyGraph, ArchRule, ParseResult, ImplicitContract,
  RuleCategory, RuleTier, RuleTrend, RuleEvidence, ArchmapConfig,
} from '../types.js';

/**
 * Infer architectural rules with semantic tiers.
 *
 * Tier logic:
 *   observation: statistical pattern found (descriptive)
 *   convention:  pattern holds >80% across >50 commits (prescriptive-soft)
 *   rule:        pattern holds >95% + confirmed by static + history (prescriptive-hard)
 */
export function inferRules(
  modules: ModuleInfo[],
  graph: DependencyGraph,
  parseResults: ParseResult[],
  contracts: ImplicitContract[],
  config: ArchmapConfig,
  previousRules?: ArchRule[],
): ArchRule[] {
  const now = new Date().toISOString();
  const rules: ArchRule[] = [];

  // 1. Boundary rules (static analysis)
  rules.push(...inferBoundaryRules(modules, now));

  // 2. Naming conventions (static analysis)
  rules.push(...inferNamingRules(parseResults, now));

  // 3. Co-change patterns → observations/conventions (git history)
  rules.push(...inferCoChangeRules(contracts, now));

  // 4. Layer violations (static analysis)
  rules.push(...inferLayerRules(graph, modules, now));

  // Assign IDs
  const numbered = rules.map((r, i) => ({
    ...r,
    id: `${r.category}-${String(i + 1).padStart(3, '0')}`,
  }));

  // Compute trends against previous scan
  const withTrends = previousRules
    ? computeTrends(numbered, previousRules, config.gitHistory.trendWindow)
    : numbered;

  // Apply decay: demote weakening/broken rules
  const withDecay = applyDecay(withTrends, previousRules);

  // Apply user overrides
  const withOverrides = applyOverrides(withDecay, config.ruleOverrides);

  return withOverrides;
}

// --- Boundary Rules ---

function inferBoundaryRules(modules: ModuleInfo[], now: string): ArchRule[] {
  const rules: ArchRule[] = [];

  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const a = modules[i];
      const b = modules[j];
      const aImportsB = a.internalDependencies.includes(b.id);
      const bImportsA = b.internalDependencies.includes(a.id);

      if (aImportsB && !bImportsA) {
        const confidence = 0.85;
        rules.push({
          id: '',
          category: 'boundary',
          tier: promoteTier(confidence, 'static-analysis'),
          confidence,
          trend: 'new',
          scope: [a.id, b.id],
          description: `'${a.name}' → '${b.name}' is one-directional. '${b.name}' never imports from '${a.name}'.`,
          action: `Do NOT add imports from '${b.id}' to '${a.id}'. This would create a circular or reverse dependency.`,
          source: 'static-analysis',
          evidence: makeEvidence(now, confidence, 0),
        });
      }

      if (!aImportsB && !bImportsA && modules.length > 3) {
        rules.push({
          id: '',
          category: 'boundary',
          tier: 'observation',
          confidence: 0.70,
          trend: 'new',
          scope: [a.id, b.id],
          description: `'${a.name}' and '${b.name}' are independent — no imports between them.`,
          action: `Consider whether introducing a dependency between these modules is intentional.`,
          source: 'static-analysis',
          evidence: makeEvidence(now, 0.70, 0),
        });
      }
    }
  }

  return rules;
}

// --- Naming Conventions ---

function inferNamingRules(parseResults: ParseResult[], now: string): ArchRule[] {
  const rules: ArchRule[] = [];
  const dirFiles = new Map<string, string[]>();

  for (const result of parseResults) {
    const dir = dirname(result.filePath);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir)!.push(basename(result.filePath));
  }

  for (const [dir, files] of dirFiles) {
    if (files.length < 3) continue;

    const suffixPattern = detectSuffixPattern(files);
    if (!suffixPattern) continue;

    const matchCount = files.filter((f) => f.match(suffixPattern.regex)).length;
    const confidence = matchCount / files.length;
    if (confidence < 0.75) continue;

    const exceptions = files.filter((f) => !f.match(suffixPattern.regex));

    rules.push({
      id: '',
      category: 'naming',
      tier: promoteTier(confidence, 'static-analysis'),
      confidence,
      trend: 'new',
      scope: [dir],
      description: `Files in '${dir}/' follow the '${suffixPattern.pattern}' naming pattern (${matchCount}/${files.length}).`,
      action: `New files in '${dir}/' should follow the '${suffixPattern.pattern}' pattern.${exceptions.length > 0 ? ` Exceptions: ${exceptions.join(', ')}` : ''}`,
      source: 'static-analysis',
      evidence: {
        ...makeEvidence(now, confidence, exceptions.length),
        details: { pattern: suffixPattern.pattern, exceptions },
      },
    });
  }

  return rules;
}

// --- Co-Change Rules (from git history) ---

function inferCoChangeRules(contracts: ImplicitContract[], now: string): ArchRule[] {
  return contracts.map((contract) => {
    const confidence = contract.confidence;
    const tier = promoteTierWithHistory(confidence, contract.occurrences);

    return {
      id: '',
      category: 'co-change' as RuleCategory,
      tier,
      confidence,
      trend: 'new' as RuleTrend,
      scope: contract.entities,
      description: contract.description,
      action: tier === 'rule'
        ? `ALWAYS check ${contract.entities.join(' and ')} when modifying either file.`
        : tier === 'convention'
          ? `Consider checking ${contract.entities.join(' and ')} when modifying either file.`
          : `These files often change together. Check if the paired file needs updates.`,
      source: 'git-history' as const,
      evidence: {
        ...makeEvidence(now, confidence, 0),
        commitsSampled: contract.occurrences,
        totalInstances: contract.occurrences,
        matchingInstances: Math.round(contract.occurrences * confidence),
      },
    };
  });
}

// --- Layer Rules ---

function inferLayerRules(graph: DependencyGraph, modules: ModuleInfo[], now: string): ArchRule[] {
  const rules: ArchRule[] = [];

  if (graph.layers.length < 2) return rules;

  // Check for layer violations: lower layers importing from higher layers
  for (let i = 0; i < graph.layers.length; i++) {
    const lowerLayer = graph.layers[i];
    for (let j = i + 1; j < graph.layers.length; j++) {
      const higherLayer = graph.layers[j];

      for (const lowerModId of lowerLayer.modules) {
        const lowerMod = modules.find((m) => m.id === lowerModId);
        if (!lowerMod) continue;

        for (const dep of lowerMod.internalDependencies) {
          if (higherLayer.modules.includes(dep)) {
            rules.push({
              id: '',
              category: 'layer',
              tier: 'observation',
              confidence: 0.75,
              trend: 'new',
              scope: [lowerModId, dep],
              description: `'${lowerModId}' (${lowerLayer.name}) imports from '${dep}' (${higherLayer.name}) — possible layer violation.`,
              action: `Review if '${lowerModId}' should depend on '${dep}'. Lower layers typically should not depend on higher layers.`,
              source: 'static-analysis',
              evidence: makeEvidence(now, 0.75, 1),
            });
          }
        }
      }
    }
  }

  return rules;
}

// --- Tier Promotion ---

function promoteTier(confidence: number, source: 'static-analysis' | 'git-history'): RuleTier {
  if (confidence >= 0.95 && source === 'static-analysis') return 'convention';
  if (confidence >= 0.80) return 'convention';
  return 'observation';
}

function promoteTierWithHistory(confidence: number, commitCount: number): RuleTier {
  // Rule: >95% confidence + confirmed across >100 commits
  if (confidence >= 0.95 && commitCount >= 100) return 'rule';
  // Convention: >80% confidence + >50 commits
  if (confidence >= 0.80 && commitCount >= 50) return 'convention';
  // Convention: >90% confidence + >20 commits
  if (confidence >= 0.90 && commitCount >= 20) return 'convention';
  return 'observation';
}

// --- Trend Computation ---

function computeTrends(
  current: ArchRule[],
  previous: ArchRule[],
  windowSize: number,
): ArchRule[] {
  return current.map((rule) => {
    // Find matching previous rule by description similarity
    const prev = previous.find((p) =>
      p.category === rule.category && p.scope.join(',') === rule.scope.join(','),
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
      evidence: {
        ...rule.evidence,
        firstSeen: prev.evidence.firstSeen || rule.evidence.firstSeen,
      },
    };
  });
}

// --- Decay ---

function applyDecay(rules: ArchRule[], previousRules?: ArchRule[]): ArchRule[] {
  if (!previousRules) return rules;

  return rules.map((rule) => {
    if (rule.trend !== 'broken' && rule.trend !== 'weakening') return rule;

    const prev = previousRules.find((p) =>
      p.category === rule.category && p.scope.join(',') === rule.scope.join(','),
    );

    // Demote only if it was also weakening/broken in previous scan (2 consecutive)
    if (prev && (prev.trend === 'broken' || prev.trend === 'weakening')) {
      const demoted = demoteTier(rule.tier);
      if (demoted !== rule.tier) {
        return {
          ...rule,
          tier: demoted,
          evidence: { ...rule.evidence, promotedFrom: rule.tier },
        };
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

function applyOverrides(
  rules: ArchRule[],
  overrides: Record<string, string> | undefined,
): ArchRule[] {
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

// --- Helpers ---

function makeEvidence(now: string, confidence: number, violations: number): RuleEvidence {
  return {
    firstSeen: now,
    commitsSampled: 0,
    recentViolations: violations,
    totalInstances: 1,
    matchingInstances: confidence >= 1 ? 1 : 0,
  };
}

interface SuffixPatternResult {
  pattern: string;
  regex: RegExp;
}

function detectSuffixPattern(files: string[]): SuffixPatternResult | null {
  const suffixes = new Map<string, number>();

  for (const file of files) {
    const match = file.match(/\.([a-z]+)\.[a-z]+$/);
    if (match) {
      suffixes.set(match[1], (suffixes.get(match[1]) ?? 0) + 1);
    }
  }

  let bestSuffix = '';
  let bestCount = 0;
  for (const [suffix, count] of suffixes) {
    if (count > bestCount) { bestSuffix = suffix; bestCount = count; }
  }

  if (bestCount >= 2 && bestCount / files.length >= 0.5) {
    return {
      pattern: `*.${bestSuffix}.*`,
      regex: new RegExp(`\\.${bestSuffix}\\.[a-z]+$`),
    };
  }

  return null;
}
