#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { scanCommand } from '../src/commands/scan.js';
import { rulesCommand } from '../src/commands/rules.js';
import { hookCommand } from '../src/commands/hook.js';
import { showCommand } from '../src/commands/show.js';

const program = new Command();

program
  .name('archmap')
  .description('Architecture-as-Code for AI Agents')
  .version('0.1.0');

program
  .command('init')
  .description('Scan repo and generate .archmap/ directory')
  .option('-r, --root <path>', 'Root directory to scan', '.')
  .option('--no-git-history', 'Skip git history analysis')
  .option('--no-agent-integration', 'Skip updating CLAUDE.md and similar files')
  .option('-v, --verbose', 'Verbose output')
  .action(initCommand);

program
  .command('scan')
  .description('Re-scan and update .archmap/')
  .option('-r, --root <path>', 'Root directory to scan', '.')
  .option('--no-git-history', 'Skip git history analysis')
  .option('-v, --verbose', 'Verbose output')
  .action(scanCommand);

program
  .command('rules')
  .description('List inferred architectural rules')
  .option('-r, --root <path>', 'Root directory', '.')
  .option('--json', 'Output as JSON')
  .action(rulesCommand);

program
  .command('show')
  .description('Show architecture overview')
  .option('-r, --root <path>', 'Root directory', '.')
  .option('--json', 'Output as JSON')
  .action(showCommand);

program
  .command('hook')
  .description('Manage git hooks')
  .argument('<action>', 'install or remove')
  .option('-r, --root <path>', 'Root directory', '.')
  .action(hookCommand);

program.parse();
