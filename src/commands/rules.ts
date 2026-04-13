import { resolve, join } from 'path';
import { readFile } from 'fs/promises';
import chalk from 'chalk';

interface RulesOptions {
  root: string;
  json: boolean;
}

export async function rulesCommand(options: RulesOptions) {
  const root = resolve(options.root);
  const rulesPath = join(root, '.archmap', 'rules.json');

  try {
    const raw = await readFile(rulesPath, 'utf-8');
    const data = JSON.parse(raw);

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (!data.rules || data.rules.length === 0) {
      console.log(chalk.yellow('No architectural rules inferred yet.'));
      console.log('Run `archmap init` or `archmap scan` with git history enabled.');
      return;
    }

    console.log(chalk.bold(`\n  Architectural Rules (${data.rules.length})\n`));

    for (const rule of data.rules) {
      const confidence = Math.round(rule.confidence * 100);
      const color = confidence >= 90 ? chalk.green : confidence >= 70 ? chalk.yellow : chalk.red;
      const icon = rule.type === 'boundary' ? '⊘' : rule.type === 'co-change' ? '⇄' : '◎';

      console.log(`  ${icon} ${chalk.bold(rule.description)}`);
      console.log(`    ${chalk.dim('Type:')} ${rule.type}  ${chalk.dim('Confidence:')} ${color(`${confidence}%`)}  ${chalk.dim('Source:')} ${rule.source}`);
      console.log('');
    }
  } catch {
    console.log(chalk.yellow('No .archmap/ directory found. Run `archmap init` first.'));
  }
}
