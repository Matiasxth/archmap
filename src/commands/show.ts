import { resolve, join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import chalk from 'chalk';

interface ShowOptions {
  root: string;
  json: boolean;
}

export async function showCommand(options: ShowOptions) {
  const root = resolve(options.root);
  const archmapDir = join(root, '.archmap');

  if (!existsSync(archmapDir)) {
    console.log(chalk.yellow('No .archmap/ directory found. Run `archmap init` first.'));
    return;
  }

  try {
    const manifestRaw = await readFile(join(archmapDir, 'manifest.json'), 'utf-8');
    const modulesRaw = await readFile(join(archmapDir, 'modules.json'), 'utf-8');
    const depsRaw = await readFile(join(archmapDir, 'dependencies.json'), 'utf-8');
    const rulesRaw = await readFile(join(archmapDir, 'rules.json'), 'utf-8');
    const contractsRaw = await readFile(join(archmapDir, 'contracts.json'), 'utf-8');

    const manifest = JSON.parse(manifestRaw);
    const modules = JSON.parse(modulesRaw);
    const deps = JSON.parse(depsRaw);
    const rules = JSON.parse(rulesRaw);
    const contracts = JSON.parse(contractsRaw);

    if (options.json) {
      console.log(JSON.stringify({ manifest, modules, dependencies: deps, rules, contracts }, null, 2));
      return;
    }

    // Launch interactive TUI
    const React = await import('react');
    const { render } = await import('ink');
    const { App } = await import('../tui/app.js');

    render(
      React.createElement(App, {
        modules: modules.modules,
        rules: rules.rules,
        contracts: contracts.contracts,
        dependencies: deps.graph,
        repoRoot: manifest.repoRoot,
        totalFiles: manifest.stats.totalFiles,
      }),
    );
  } catch (error) {
    console.log(chalk.yellow('Failed to load .archmap/ data. Run `archmap init` first.'));
    if (error instanceof Error) console.error(chalk.dim(error.message));
  }
}
