import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { scanProject } from '../scanner/index.js';
import { writeOutput } from '../output/writer.js';
import { generateMarkdown } from '../output/markdown-generator.js';
import { integrateWithAgents } from '../output/agent-integrator.js';
import { loadConfig, createDefaultConfig } from '../utils/config.js';

interface InitOptions {
  root: string;
  gitHistory: boolean;
  agentIntegration: boolean;
  verbose: boolean;
}

export async function initCommand(options: InitOptions) {
  const root = resolve(options.root);
  const spinner = ora('Initializing archmap...').start();

  try {
    // Create default config if it doesn't exist
    await createDefaultConfig(root);
    const config = await loadConfig(root);

    // Run full scan
    spinner.text = 'Scanning project files...';
    const result = await scanProject(root, {
      gitHistory: options.gitHistory,
      verbose: options.verbose,
      config,
    });

    // Write .archmap/ output
    spinner.text = 'Writing .archmap/ directory...';
    await writeOutput(root, result);

    // Generate SUMMARY.md
    spinner.text = 'Generating SUMMARY.md...';
    const summary = generateMarkdown(result);
    const { writeFile } = await import('fs/promises');
    const { join } = await import('path');
    await writeFile(join(root, '.archmap', 'SUMMARY.md'), summary, 'utf-8');

    // Integrate with agent files
    if (options.agentIntegration) {
      spinner.text = 'Updating agent context files...';
      await integrateWithAgents(root, summary, config);
    }

    spinner.succeed(chalk.green('archmap initialized successfully!'));

    // Print summary stats
    console.log('');
    console.log(`  ${chalk.bold('Files scanned:')}    ${result.stats.totalFiles}`);
    console.log(`  ${chalk.bold('Modules found:')}    ${result.stats.totalModules}`);
    console.log(`  ${chalk.bold('Dependencies:')}     ${result.stats.totalDependencies}`);
    console.log(`  ${chalk.bold('Rules inferred:')}   ${result.stats.totalRules}`);
    console.log(`  ${chalk.bold('Contracts found:')}  ${result.stats.totalContracts}`);
    console.log('');
    console.log(`  Output: ${chalk.cyan('.archmap/')}`);
    console.log(`  Summary: ${chalk.cyan('.archmap/SUMMARY.md')}`);
  } catch (error) {
    spinner.fail(chalk.red('Failed to initialize archmap'));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    } else if (error instanceof Error) {
      console.error(`  ${error.message}`);
    }
    process.exit(1);
  }
}
