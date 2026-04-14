import { resolve, join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { scanProject } from '../scanner/index.js';
import { loadConfig } from '../utils/config.js';
import { computeArchDelta } from '../analysis/arch-delta.js';
import type { ScanResult } from '../types.js';

interface DiffOptions {
  root: string;
  json: boolean;
}

export async function diffCommand(options: DiffOptions) {
  const root = resolve(options.root);
  const prevPath = join(root, '.archmap', 'previous-scan.json');

  if (!existsSync(prevPath)) {
    console.log(chalk.yellow('  No previous scan found. Run `archmap init` first, then `archmap diff` after your next scan.'));
    return;
  }

  try {
    const before: ScanResult = JSON.parse(await readFile(prevPath, 'utf-8'));
    const config = await loadConfig(root);
    const after = await scanProject(root, { gitHistory: true, verbose: false, config });

    const delta = computeArchDelta(before, after);

    if (options.json) {
      console.log(JSON.stringify(delta, null, 2));
      return;
    }

    console.log(chalk.bold('\n  archmap diff — architectural changes\n'));

    if (delta.newDependencies.length > 0) {
      console.log(chalk.yellow(`  ${delta.newDependencies.length} new dependency(ies):`));
      for (const d of delta.newDependencies.slice(0, 10)) {
        console.log(chalk.yellow(`    + ${d.from} → ${d.to}`));
      }
      console.log('');
    }

    if (delta.removedDependencies.length > 0) {
      console.log(chalk.green(`  ${delta.removedDependencies.length} removed dependency(ies):`));
      for (const d of delta.removedDependencies.slice(0, 10)) {
        console.log(chalk.green(`    - ${d.from} → ${d.to}`));
      }
      console.log('');
    }

    if (delta.newModules.length > 0) {
      console.log(chalk.cyan(`  ${delta.newModules.length} new module(s): ${delta.newModules.join(', ')}`));
      console.log('');
    }

    if (delta.removedModules.length > 0) {
      console.log(chalk.red(`  ${delta.removedModules.length} removed module(s): ${delta.removedModules.join(', ')}`));
      console.log('');
    }

    if (delta.riskChanges.length > 0) {
      console.log(chalk.magenta(`  ${delta.riskChanges.length} risk change(s):`));
      for (const r of delta.riskChanges.slice(0, 10)) {
        const arrow = r.before < r.after ? '↑' : '↓';
        console.log(chalk.magenta(`    ${arrow} ${r.file}: ${r.before} → ${r.after}`));
      }
      console.log('');
    }

    const rc = delta.ruleChanges;
    if (rc.added || rc.removed || rc.promoted || rc.demoted) {
      console.log(`  Rule changes: +${rc.added} -${rc.removed} ↑${rc.promoted} ↓${rc.demoted}`);
      console.log('');
    }

    if (!delta.newDependencies.length && !delta.removedDependencies.length && !delta.newModules.length && !delta.riskChanges.length) {
      console.log(chalk.green('  No architectural changes detected.'));
      console.log('');
    }
  } catch (error) {
    console.error(chalk.red(`  Failed: ${(error as Error).message}`));
  }
}
