import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import YAML from 'yaml';
import type { ArchRule, RuleCategory } from '../types.js';

interface ManualRuleEntry {
  description: string;
  category: RuleCategory;
  scope?: string[];
  action?: string;
}

interface ManualRulesFile {
  rules: ManualRuleEntry[];
}

/**
 * Load user-declared rules from .archmap/rules.yml.
 * Manual rules are always tier: 'rule' and source: 'manual'.
 */
export async function loadManualRules(root: string): Promise<ArchRule[]> {
  const yamlPath = join(root, '.archmap', 'rules.yml');

  if (!existsSync(yamlPath)) return [];

  try {
    const raw = await readFile(yamlPath, 'utf-8');
    const parsed: ManualRulesFile = YAML.parse(raw);

    if (!parsed?.rules || !Array.isArray(parsed.rules)) return [];

    return parsed.rules.map((entry, i) => ({
      id: `manual-${String(i + 1).padStart(3, '0')}`,
      category: entry.category || 'boundary',
      tier: 'rule' as const,
      confidence: 1.0,
      trend: 'stable' as const,
      scope: entry.scope ?? ['*'],
      description: entry.description,
      action: entry.action ?? `This is a team-defined rule: ${entry.description}`,
      source: 'manual' as const,
      evidence: {
        firstSeen: new Date().toISOString(),
        commitsSampled: 0,
        recentViolations: 0,
        totalInstances: 0,
        matchingInstances: 0,
      },
    }));
  } catch {
    return [];
  }
}
