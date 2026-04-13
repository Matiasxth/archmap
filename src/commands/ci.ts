import { resolve, join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { scanProject } from '../scanner/index.js';
import { loadConfig } from '../utils/config.js';
import { findCircularDeps, buildDependencyGraph } from '../analysis/dependency-graph.js';
import type { ArchRule } from '../types.js';

interface CiOptions {
  root: string;
  minConfidence: string;
  json: boolean;
}

interface Violation {
  rule: ArchRule;
  severity: 'error' | 'warning';
}

/**
 * CI mode: scan the project and exit non-zero if architectural rules are violated.
 * Designed for CI/CD pipelines.
 */
export async function ciCommand(options: CiOptions) {
  const root = resolve(options.root);
  const minConfidence = parseFloat(options.minConfidence);
  const violations: Violation[] = [];

  try {
    const config = await loadConfig(root);

    // Run a fresh scan
    const result = await scanProject(root, {
      gitHistory: true,
      verbose: false,
      config,
    });

    // Check 1: Circular dependencies
    const cycles = findCircularDeps(
      buildDependencyGraph(result.parseResults, root),
    );
    if (cycles.length > 0) {
      for (const cycle of cycles) {
        violations.push({
          rule: {
            id: 'circular-dep',
            type: 'boundary',
            confidence: 1.0,
            description: `Circular dependency: ${cycle.join(' → ')}`,
            source: 'static-analysis',
            evidence: { cycle },
          },
          severity: 'error',
        });
      }
    }

    // Check 2: High-confidence rules — if we have a previous scan, compare
    const rulesPath = join(root, '.archmap', 'rules.json');
    if (existsSync(rulesPath)) {
      const prevData = JSON.parse(await readFile(rulesPath, 'utf-8'));
      const prevRules: ArchRule[] = prevData.rules.filter(
        (r: ArchRule) => r.confidence >= minConfidence,
      );

      // Check if any previous boundary rules are now violated
      for (const prevRule of prevRules) {
        if (prevRule.type === 'boundary' && prevRule.evidence) {
          const ev = prevRule.evidence as Record<string, string>;
          if (ev.from && ev.to && ev.direction === 'unidirectional') {
            // Check if the reverse dependency now exists
            const mod = result.modules.find((m) => m.id === ev.to);
            if (mod && mod.internalDependencies.includes(ev.from)) {
              violations.push({
                rule: {
                  ...prevRule,
                  description: `VIOLATED: ${prevRule.description}`,
                },
                severity: 'error',
              });
            }
          }
        }
      }
    }

    // Check 3: Naming convention violations
    for (const rule of result.rules) {
      if (
        rule.type === 'naming-convention' &&
        rule.confidence >= minConfidence &&
        rule.evidence
      ) {
        const ev = rule.evidence as { exceptions?: string[] };
        if (ev.exceptions && ev.exceptions.length > 0) {
          violations.push({ rule, severity: 'warning' });
        }
      }
    }

    // Output
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            passed: violations.filter((v) => v.severity === 'error').length === 0,
            violations: violations.map((v) => ({
              severity: v.severity,
              type: v.rule.type,
              description: v.rule.description,
              confidence: v.rule.confidence,
            })),
            stats: result.stats,
          },
          null,
          2,
        ),
      );
    } else {
      const errors = violations.filter((v) => v.severity === 'error');
      const warnings = violations.filter((v) => v.severity === 'warning');

      console.log('');
      console.log(
        chalk.bold(`  archmap ci — ${result.stats.totalFiles} files, ${result.stats.totalModules} modules`),
      );
      console.log('');

      if (errors.length > 0) {
        console.log(chalk.red.bold(`  ${errors.length} error(s):`));
        for (const v of errors) {
          console.log(chalk.red(`    ✗ ${v.rule.description}`));
        }
        console.log('');
      }

      if (warnings.length > 0) {
        console.log(chalk.yellow.bold(`  ${warnings.length} warning(s):`));
        for (const v of warnings) {
          console.log(chalk.yellow(`    ⚠ ${v.rule.description}`));
        }
        console.log('');
      }

      if (errors.length === 0 && warnings.length === 0) {
        console.log(chalk.green('  ✓ All architectural rules pass.'));
        console.log('');
      } else if (errors.length === 0) {
        console.log(
          chalk.green('  ✓ No errors. Warnings do not fail the build.'),
        );
        console.log('');
      }
    }

    // Exit code: non-zero only for errors
    const errorCount = violations.filter((v) => v.severity === 'error').length;
    if (errorCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ passed: false, error: (error as Error).message }));
    } else {
      console.error(chalk.red(`  ✗ CI check failed: ${(error as Error).message}`));
    }
    process.exit(1);
  }
}
