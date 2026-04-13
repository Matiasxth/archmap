import { resolve, join } from 'path';
import { readFile } from 'fs/promises';
import chalk from 'chalk';

interface ShowOptions {
  root: string;
  json: boolean;
}

export async function showCommand(options: ShowOptions) {
  const root = resolve(options.root);

  try {
    const manifestRaw = await readFile(join(root, '.archmap', 'manifest.json'), 'utf-8');
    const modulesRaw = await readFile(join(root, '.archmap', 'modules.json'), 'utf-8');
    const depsRaw = await readFile(join(root, '.archmap', 'dependencies.json'), 'utf-8');

    const manifest = JSON.parse(manifestRaw);
    const modules = JSON.parse(modulesRaw);
    const deps = JSON.parse(depsRaw);

    if (options.json) {
      console.log(JSON.stringify({ manifest, modules, dependencies: deps }, null, 2));
      return;
    }

    console.log(chalk.bold(`\n  archmap — ${manifest.repoRoot}\n`));
    console.log(`  ${chalk.dim('Generated:')} ${manifest.generatedAt}`);
    console.log(`  ${chalk.dim('Languages:')} ${manifest.languages.join(', ')}`);
    console.log(`  ${chalk.dim('Files:')} ${manifest.stats.totalFiles}  ${chalk.dim('Modules:')} ${manifest.stats.totalModules}  ${chalk.dim('Rules:')} ${manifest.stats.totalRules}`);
    console.log('');

    // Module table
    console.log(chalk.bold('  Modules'));
    console.log(chalk.dim('  ─'.repeat(30)));

    for (const mod of modules.modules) {
      const exportCount = mod.publicApi?.exports?.length ?? 0;
      const depCount = mod.internalDependencies?.length ?? 0;
      console.log(`  ${chalk.cyan(mod.name.padEnd(25))} ${chalk.dim('exports:')} ${String(exportCount).padEnd(4)} ${chalk.dim('deps:')} ${depCount}`);
    }

    // Dependency layers
    if (deps.layers && deps.layers.length > 0) {
      console.log('');
      console.log(chalk.bold('  Layers'));
      console.log(chalk.dim('  ─'.repeat(30)));
      for (let i = 0; i < deps.layers.length; i++) {
        const layer = deps.layers[i];
        console.log(`  ${i + 1}. ${chalk.bold(layer.name)} → ${layer.modules.join(', ')}`);
      }
    }

    console.log('');
  } catch {
    console.log(chalk.yellow('No .archmap/ directory found. Run `archmap init` first.'));
  }
}
