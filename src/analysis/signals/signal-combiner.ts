import type { ArchRule, RuleCategory, RuleTier, RuleTrend, RuleEvidence } from '../../types.js';
import type { Signal, ArchPattern } from './types.js';

/**
 * Combine convergent signals into tiered rules.
 *
 * Core principle: rules emerge from convergence, not from individual signals.
 *   1 signal  → observation (informational)
 *   2 signals → convention (prescriptive-soft)
 *   3+ signals OR arch-pattern confirmed → rule (prescriptive-hard)
 *   config-boundary signal → always rule (explicit human decision)
 */
export function combineSignals(
  signals: Signal[],
  pattern: ArchPattern | null,
): ArchRule[] {
  const now = new Date().toISOString();

  // Group signals by scope (normalized key)
  const groups = groupSignalsByScope(signals);

  const rules: ArchRule[] = [];

  for (const [scopeKey, group] of groups) {
    const scope = group[0].scope;
    const category = inferCategory(group);
    const signalCount = group.length;
    const uniqueKinds = new Set(group.map((s) => s.kind)).size;

    // Determine tier based on signal convergence
    const tier = determineTier(group, pattern);

    // Combined strength: geometric mean of individual strengths, boosted by diversity
    const avgStrength = group.reduce((sum, s) => sum + s.strength, 0) / signalCount;
    const diversityBoost = Math.min(0.2, uniqueKinds * 0.05);
    const confidence = Math.min(0.99, avgStrength + diversityBoost);

    // Generate contextual description
    const description = generateDescription(group, pattern, category);

    // Generate specific action
    const action = generateAction(group, pattern, tier, category);

    rules.push({
      id: '',
      category,
      tier,
      confidence,
      trend: 'new' as RuleTrend,
      scope,
      description,
      action,
      source: inferSource(group),
      evidence: {
        firstSeen: now,
        commitsSampled: Math.max(...group.map((s) => s.context.coChangeCount ?? 0), 0),
        recentViolations: 0,
        totalInstances: signalCount,
        matchingInstances: signalCount,
        details: {
          signalKinds: [...new Set(group.map((s) => s.kind))],
          signalCount,
          uniqueKinds,
          individualStrengths: group.map((s) => ({ kind: s.kind, strength: s.strength })),
        },
      },
    });
  }

  // Assign IDs
  return rules.map((r, i) => ({
    ...r,
    id: `${r.category}-${String(i + 1).padStart(3, '0')}`,
  }));
}

// --- Grouping ---

function groupSignalsByScope(signals: Signal[]): Map<string, Signal[]> {
  const groups = new Map<string, Signal[]>();

  for (const signal of signals) {
    // Normalize scope key: sort module IDs to group bidirectional relationships
    const key = [...signal.scope].sort().join('|');

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(signal);
  }

  return groups;
}

// --- Tier Determination ---

function determineTier(signals: Signal[], pattern: ArchPattern | null): RuleTier {
  const uniqueKinds = new Set(signals.map((s) => s.kind));
  const hasConfigBoundary = uniqueKinds.has('config-boundary');
  const hasArchPattern = uniqueKinds.has('arch-pattern-match');
  const hasRemovedDep = uniqueKinds.has('removed-dependency');
  const maxStrength = Math.max(...signals.map((s) => s.strength));

  // Explicit human decision → always rule
  if (hasConfigBoundary) return 'rule';

  // Arch pattern confirmed + at least one other signal → rule
  if (hasArchPattern && uniqueKinds.size >= 2) return 'rule';

  // Removed dependency (intentional decision) + static confirmation → rule
  if (hasRemovedDep && uniqueKinds.size >= 2) return 'rule';

  // 3+ different signal kinds → rule
  if (uniqueKinds.size >= 3 && maxStrength >= 0.6) return 'rule';

  // 2 different signal kinds → convention
  if (uniqueKinds.size >= 2) return 'convention';

  // Single signal with high strength → convention
  if (signals.length === 1 && maxStrength >= 0.8) return 'convention';

  // Default: observation
  return 'observation';
}

// --- Category Inference ---

function inferCategory(signals: Signal[]): RuleCategory {
  const kinds = signals.map((s) => s.kind);

  if (kinds.includes('naming-pattern')) return 'naming';
  if (kinds.includes('co-change') || kinds.includes('change-frequency') || kinds.includes('unstable-hotspot')) return 'co-change';
  if (kinds.includes('layer-position') || kinds.includes('arch-pattern-match')) return 'layer';
  if (kinds.includes('unidirectional') || kinds.includes('no-import') || kinds.includes('negative-space') || kinds.includes('config-boundary')) return 'boundary';

  return 'boundary';
}

// --- Contextual Description ---

function generateDescription(signals: Signal[], pattern: ArchPattern | null, category: RuleCategory): string {
  // Use the strongest signal's description as the base
  const primary = signals.reduce((best, s) => s.strength > best.strength ? s : best, signals[0]);
  const parts: string[] = [primary.description];

  // Add context from other signals
  const otherKinds = new Set(signals.filter((s) => s !== primary).map((s) => s.kind));

  if (otherKinds.has('negative-space')) {
    const ns = signals.find((s) => s.kind === 'negative-space');
    if (ns?.context.selectivity) {
      parts.push(`(imports from ${Math.round(ns.context.selectivity * 100)}% of available modules, this absence is selective)`);
    }
  }

  if (otherKinds.has('high-fan-in')) {
    const fi = signals.find((s) => s.kind === 'high-fan-in');
    if (fi?.context.fanIn) {
      parts.push(`(${fi.context.fanIn} modules depend on this — stable core)`);
    }
  }

  if (otherKinds.has('arch-pattern-match') && pattern) {
    parts.push(`(aligns with ${pattern.name} pattern)`);
  }

  if (otherKinds.has('removed-dependency')) {
    const rd = signals.find((s) => s.kind === 'removed-dependency');
    if (rd?.context.commitMessage) {
      parts.push(`(dependency was intentionally removed: "${rd.context.commitMessage}")`);
    }
  }

  if (otherKinds.has('config-boundary')) {
    const cb = signals.find((s) => s.kind === 'config-boundary');
    if (cb?.context.configFile) {
      parts.push(`(enforced by ${cb.context.configFile})`);
    }
  }

  return parts.join(' ');
}

// --- Contextual Actions ---

function generateAction(signals: Signal[], pattern: ArchPattern | null, tier: RuleTier, category: RuleCategory): string {
  const scope = signals[0].scope;
  const kindSet = new Set(signals.map((s) => s.kind));

  // Config-defined boundary
  if (kindSet.has('config-boundary')) {
    const cb = signals.find((s) => s.kind === 'config-boundary');
    return `This boundary is enforced by ${cb?.context.configFile}. Violating it will fail linting. Do NOT add cross-boundary imports without updating the config.`;
  }

  // Architectural pattern rule
  if (kindSet.has('arch-pattern-match') && pattern) {
    const ap = signals.find((s) => s.kind === 'arch-pattern-match');
    return `This project follows ${pattern.name}. ${ap?.context.expectedRule ?? 'Respect the layer boundaries.'}. Violating this degrades the architecture.`;
  }

  // Unstable hotspot
  if (kindSet.has('unstable-hotspot')) {
    const uh = signals.find((s) => s.kind === 'unstable-hotspot');
    return `${scope[0]} changes frequently and has ${uh?.context.fanIn} dependents. Changes here ripple widely. Consider stabilizing this module's API or reducing its dependents.`;
  }

  // Boundary with negative space evidence
  if (kindSet.has('negative-space') && kindSet.has('unidirectional')) {
    const ns = signals.find((s) => s.kind === 'negative-space');
    return `This module imports from ${ns?.context.importCount} other modules but deliberately avoids ${scope[1] ?? 'this one'}. This absence appears intentional — do NOT introduce this dependency without team review.`;
  }

  // Co-change contract
  if (kindSet.has('co-change')) {
    const cc = signals.find((s) => s.kind === 'co-change');
    const paired = scope.length >= 2 ? scope.join(' and ') : scope[0];
    if (tier === 'rule') {
      return `ALWAYS check ${paired} when modifying either file — they change together ${cc?.context.coChangeCount ?? ''}+ times in history.`;
    }
    return `Consider checking ${paired} when modifying either — they change together frequently.`;
  }

  // Generic by tier
  if (tier === 'rule') {
    return `Do NOT violate this boundary. It is confirmed by ${signals.length} independent signals.`;
  }
  if (tier === 'convention') {
    return `Follow this pattern unless you have a specific reason not to. Confirmed by ${signals.length} signal(s).`;
  }
  return `Be aware of this pattern.`;
}

// --- Source Inference ---

function inferSource(signals: Signal[]): 'git-history' | 'static-analysis' | 'manual' {
  const kinds = new Set(signals.map((s) => s.kind));
  if (kinds.has('config-boundary')) return 'manual';
  if (kinds.has('co-change') || kinds.has('removed-dependency') || kinds.has('change-frequency')) return 'git-history';
  return 'static-analysis';
}
