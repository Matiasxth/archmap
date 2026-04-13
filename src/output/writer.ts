import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ScanResult } from '../types.js';

/**
 * Write all .archmap/ JSON files from scan results.
 */
export async function writeOutput(root: string, result: ScanResult): Promise<void> {
  const dir = join(root, '.archmap');

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // Write manifest
  await writeJson(join(dir, 'manifest.json'), {
    ...result.manifest,
    stats: result.stats,
  });

  // Write modules
  await writeJson(join(dir, 'modules.json'), {
    modules: result.modules,
  });

  // Write dependencies
  await writeJson(join(dir, 'dependencies.json'), {
    graph: result.dependencies,
  });

  // Write rules
  await writeJson(join(dir, 'rules.json'), {
    rules: result.rules,
  });

  // Write contracts
  await writeJson(join(dir, 'contracts.json'), {
    contracts: result.contracts,
  });
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}
