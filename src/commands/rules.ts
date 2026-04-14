import { resolve, join } from 'path';
import { readFile } from 'fs/promises';
import chalk from 'chalk';
import type { ArchRule } from '../types.js';

interface RulesOptions {
  root: string;
  tier: string;
  json: boolean;
}

export async function rulesCommand(options: RulesOptions) {
  const root = resolve(options.root);
  const rulesPath = join(root, '.archmap', 'rules.json');

  try {
    const raw = await readFile(rulesPath, 'utf-8');
    const data = JSON.parse(raw);
    let rules: ArchRule[] = data.rules ?? [];

    // Filter by tier if specified
    if (options.tier && options.tier !== 'all') {
      rules = rules.filter((r) => r.tier === options.tier);
    }

    if (options.json) {
      console.log(JSON.stringify(rules, null, 2));
      return;
    }

    if (rules.length === 0) {
      console.log(chalk.yellow('No rules found. Run `archmap init` or `archmap scan` first.'));
      return;
    }

    // Group by tier
    const tiers = ['rule', 'convention', 'observation'] as const;
    const tierLabels = { rule: 'Rules (MUST)', convention: 'Conventions (SHOULD)', observation: 'Observations (INFO)' };
    const tierColors = { rule: chalk.red, convention: chalk.yellow, observation: chalk.dim };
    const tierIcons = { rule: '✗', convention: '⚠', observation: '○' };

    for (const tier of tiers) {
      const tierRules = rules.filter((r) => r.tier === tier);
      if (tierRules.length === 0) continue;

      console.log('');
      console.log(chalk.bold(`  ${tierLabels[tier]} (${tierRules.length})`));
      console.log(chalk.dim('  ─'.repeat(30)));

      for (const rule of tierRules.sort((a, b) => b.confidence - a.confidence)) {
        const pct = Math.round(rule.confidence * 100);
        const color = tierColors[tier];
        const icon = tierIcons[tier];
        const trendIcon = rule.trend === 'strengthening' ? '↗' : rule.trend === 'weakening' ? '↘' : rule.trend === 'broken' ? '↓' : rule.trend === 'new' ? '★' : ' ';
        const src = rule.source === 'manual' ? chalk.cyan('[manual]') : '';

        console.log(color(`  ${icon} ${trendIcon} [${pct}%] ${rule.description} ${src}`));
        if (tier === 'rule' || tier === 'convention') {
          console.log(chalk.dim(`      → ${rule.action}`));
        }
      }
    }

    console.log('');
  } catch {
    console.log(chalk.yellow('No .archmap/ directory found. Run `archmap init` first.'));
  }
}
