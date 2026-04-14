import { resolve } from 'path';
import chalk from 'chalk';
import { scanProject } from '../scanner/index.js';
import { loadConfig } from '../utils/config.js';

interface CiOptions {
  root: string;
  minConfidence: string;
  strict: boolean;
  json: boolean;
}

/**
 * CI mode: tier-aware exit codes.
 *   - Rules violated → exit 1 (error)
 *   - Conventions violated → warning (or exit 1 if --strict)
 *   - Observations → informational only
 */
export async function ciCommand(options: CiOptions) {
  const root = resolve(options.root);

  try {
    const config = await loadConfig(root);
    const result = await scanProject(root, {
      gitHistory: true,
      verbose: false,
      config,
    });

    const ruleViolations = result.rules.filter((r) => r.tier === 'rule' && r.evidence.recentViolations > 0);
    const conventionViolations = result.rules.filter((r) => r.tier === 'convention' && r.evidence.recentViolations > 0);
    const weakening = result.rules.filter((r) => r.trend === 'weakening' || r.trend === 'broken');

    const hasErrors = ruleViolations.length > 0 || (options.strict && conventionViolations.length > 0);

    if (options.json) {
      console.log(JSON.stringify({
        passed: !hasErrors,
        health: result.health,
        violations: {
          rules: ruleViolations.map((r) => ({ tier: r.tier, category: r.category, description: r.description, action: r.action })),
          conventions: conventionViolations.map((r) => ({ tier: r.tier, category: r.category, description: r.description, action: r.action })),
        },
        drift: weakening.map((r) => ({ tier: r.tier, trend: r.trend, description: r.description })),
        stats: result.stats,
      }, null, 2));
    } else {
      const h = result.health;
      console.log('');
      console.log(chalk.bold(`  archmap ci — ${result.stats.totalFiles} files, ${result.stats.totalModules} modules`));
      console.log(`  Health: ${scoreColor(h.overall)}${h.overall}/100${chalk.reset} | ${result.stats.totalStrongRules} rules, ${result.stats.totalConventions} conventions, ${result.stats.totalObservations} observations`);
      console.log('');

      if (ruleViolations.length > 0) {
        console.log(chalk.red.bold(`  ${ruleViolations.length} rule violation(s):`));
        for (const v of ruleViolations) {
          console.log(chalk.red(`    ✗ [RULE] ${v.description}`));
          console.log(chalk.dim(`      → ${v.action}`));
        }
        console.log('');
      }

      if (conventionViolations.length > 0) {
        console.log(chalk.yellow.bold(`  ${conventionViolations.length} convention violation(s):`));
        for (const v of conventionViolations) {
          console.log(chalk.yellow(`    ⚠ [CONVENTION] ${v.description}`));
          console.log(chalk.dim(`      → ${v.action}`));
        }
        console.log('');
      }

      if (weakening.length > 0) {
        console.log(chalk.magenta(`  ${weakening.length} drifting pattern(s):`));
        for (const w of weakening) {
          console.log(chalk.dim(`    ↘ [${w.trend.toUpperCase()}] ${w.description}`));
        }
        console.log('');
      }

      if (!hasErrors && ruleViolations.length === 0 && conventionViolations.length === 0) {
        console.log(chalk.green('  ✓ All architectural rules and conventions pass.'));
        console.log('');
      } else if (!hasErrors) {
        console.log(chalk.green('  ✓ No rule errors. Convention warnings do not fail the build.'));
        console.log('');
      }
    }

    if (hasErrors) process.exit(1);
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ passed: false, error: (error as Error).message }));
    } else {
      console.error(chalk.red(`  ✗ CI check failed: ${(error as Error).message}`));
    }
    process.exit(1);
  }
}

function scoreColor(score: number): string {
  if (score >= 90) return chalk.green('');
  if (score >= 70) return chalk.yellow('');
  return chalk.red('');
}
