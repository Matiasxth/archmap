import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { scanProject } from '../scanner/index.js';
import { writeOutput } from '../output/writer.js';
import { generateMarkdown } from '../output/markdown-generator.js';
import { integrateWithAgents } from '../output/agent-integrator.js';
import { loadConfig } from '../utils/config.js';

interface ScanOptions {
  root: string;
  gitHistory: boolean;
  strictAst: boolean;
  verbose: boolean;
}

export async function scanCommand(options: ScanOptions) {
  const root = resolve(options.root);
  const spinner = ora('Scanning project...').start();

  try {
    const config = await loadConfig(root);

    spinner.text = 'Analyzing files...';
    const result = await scanProject(root, {
      gitHistory: options.gitHistory,
      strictAst: options.strictAst,
      verbose: options.verbose,
      config,
    });

    spinner.text = 'Writing .archmap/ directory...';
    await writeOutput(root, result);

    const summary = generateMarkdown(result);
    const { writeFile } = await import('fs/promises');
    const { join } = await import('path');
    await writeFile(join(root, '.archmap', 'SUMMARY.md'), summary, 'utf-8');

    if (config.agentIntegration?.updateClaudeMd) {
      await integrateWithAgents(root, summary, config);
    }

    const p = result.stats.parsing;
    const parsingInfo = p.pct === 100 ? '100% AST' : `${p.pct}% AST, ${p.regex} regex`;
    spinner.succeed(chalk.green(`Scan complete — ${result.stats.totalFiles} files, ${result.stats.totalModules} modules, ${parsingInfo}`));
  } catch (error) {
    spinner.fail(chalk.red('Scan failed'));
    if (error instanceof Error) console.error(`  ${error.message}`);
    process.exit(1);
  }
}
