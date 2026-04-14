import type { ArchRule, RuleCategory, RuleTier } from '../types.js';

/**
 * Migrate rules from schema v1 (flat) to schema v2 (tiered).
 * Auto-assigns tiers based on confidence and type.
 */
export function migrateRulesV1toV2(rules: any[]): ArchRule[] {
  return rules.map((rule, i) => {
    // Already v2
    if (rule.tier && rule.category) return rule as ArchRule;

    // v1 → v2 migration
    const category = mapCategory(rule.type);
    const confidence = rule.confidence ?? 0.5;
    const tier = autoAssignTier(confidence, category);

    return {
      id: rule.id || `migrated-${String(i + 1).padStart(3, '0')}`,
      category,
      tier,
      confidence,
      trend: 'stable' as const,
      scope: extractScope(rule),
      description: rule.description || '',
      action: generateAction(rule.description || '', tier),
      source: rule.source || 'static-analysis',
      evidence: {
        firstSeen: new Date().toISOString(),
        commitsSampled: (rule.evidence as any)?.commits_analyzed ?? 0,
        recentViolations: (rule.evidence as any)?.violations_found ?? 0,
        totalInstances: 1,
        matchingInstances: confidence >= 0.5 ? 1 : 0,
        promotedFrom: undefined,
        details: rule.evidence,
      },
    } satisfies ArchRule;
  });
}

function mapCategory(type: string | undefined): RuleCategory {
  switch (type) {
    case 'boundary': return 'boundary';
    case 'co-change': return 'co-change';
    case 'naming-convention': return 'naming';
    case 'layer': return 'layer';
    default: return 'boundary';
  }
}

function autoAssignTier(confidence: number, category: RuleCategory): RuleTier {
  if (confidence >= 0.95 && category === 'boundary') return 'rule';
  if (confidence >= 0.90) return 'convention';
  if (confidence >= 0.80) return 'convention';
  return 'observation';
}

function extractScope(rule: any): string[] {
  if (rule.scope) return rule.scope;

  const ev = rule.evidence as Record<string, any> | undefined;
  if (!ev) return ['*'];

  if (ev.from && ev.to) return [ev.from, ev.to];
  if (ev.moduleA && ev.moduleB) return [ev.moduleA, ev.moduleB];
  if (ev.directory) return [ev.directory];
  return ['*'];
}

function generateAction(description: string, tier: RuleTier): string {
  if (tier === 'rule') return `Do NOT violate this: ${description}`;
  if (tier === 'convention') return `Follow this pattern unless you have a specific reason: ${description}`;
  return `Be aware of this pattern.`;
}
