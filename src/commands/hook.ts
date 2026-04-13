import { resolve } from 'path';
import chalk from 'chalk';
import { installHook, removeHook } from '../git/hook-manager.js';

export async function hookCommand(action: string, options: { root: string }) {
  const root = resolve(options.root);

  if (action === 'install') {
    try {
      await installHook(root);
      console.log(chalk.green('  Git pre-commit hook installed.'));
      console.log(chalk.dim('  archmap will auto-scan on every commit.'));
    } catch (error) {
      console.error(chalk.red('  Failed to install hook.'));
      if (error instanceof Error) console.error(`  ${error.message}`);
    }
  } else if (action === 'remove') {
    try {
      await removeHook(root);
      console.log(chalk.green('  Git pre-commit hook removed.'));
    } catch (error) {
      console.error(chalk.red('  Failed to remove hook.'));
      if (error instanceof Error) console.error(`  ${error.message}`);
    }
  } else {
    console.error(chalk.red(`  Unknown action: ${action}. Use "install" or "remove".`));
    process.exit(1);
  }
}
