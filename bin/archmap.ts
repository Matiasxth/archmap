#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { scanCommand } from '../src/commands/scan.js';
import { rulesCommand } from '../src/commands/rules.js';
import { hookCommand } from '../src/commands/hook.js';
import { showCommand } from '../src/commands/show.js';
import { ciCommand } from '../src/commands/ci.js';
import { mcpCommand } from '../src/commands/mcp.js';
import { getVersion } from '../src/utils/version.js';

const program = new Command();

program
  .name('archmap')
  .description('Architecture-as-Code for AI Agents')
  .version(getVersion());

program
  .command('init')
  .description('Scan repo and generate .archmap/ directory')
  .option('-r, --root <path>', 'Root directory to scan', '.')
  .option('--no-git-history', 'Skip git history analysis')
  .option('--no-agent-integration', 'Skip updating CLAUDE.md and similar files')
  .option('--strict-ast', 'Fail if any file falls back to regex parsing')
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
  .description('List architectural rules grouped by tier')
  .option('-r, --root <path>', 'Root directory', '.')
  .option('-t, --tier <tier>', 'Filter by tier: rule, convention, observation, all', 'all')
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

program
  .command('ci')
  .description('Check architectural rules — exits non-zero on violations (for CI)')
  .option('-r, --root <path>', 'Root directory', '.')
  .option('--min-confidence <n>', 'Minimum rule confidence to enforce (0-1)', '0.8')
  .option('--strict', 'Treat convention violations as errors too')
  .option('--json', 'Output as JSON')
  .action(ciCommand);

program
  .command('mcp')
  .description('Start MCP server (stdio transport) for AI agent integration')
  .option('-r, --root <path>', 'Root directory', '.')
  .action(mcpCommand);

program.parse();
