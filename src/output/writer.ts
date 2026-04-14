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

  // Write manifest (includes health score)
  await writeJson(join(dir, 'manifest.json'), {
    schemaVersion: result.schemaVersion,
    ...result.manifest,
    stats: result.stats,
    health: result.health,
  });

  // Write modules
  await writeJson(join(dir, 'modules.json'), {
    modules: result.modules,
  });

  // Write dependencies
  await writeJson(join(dir, 'dependencies.json'), {
    graph: result.dependencies,
  });

  // Write rules (schema v2 with tiers)
  await writeJson(join(dir, 'rules.json'), {
    schemaVersion: result.schemaVersion,
    rules: result.rules,
  });

  // Write contracts
  await writeJson(join(dir, 'contracts.json'), {
    contracts: result.contracts,
  });

  // Write file-level analysis
  await writeJson(join(dir, 'file-risks.json'), {
    fileRisks: result.fileRisks,
    criticalPaths: result.criticalPaths,
    hotFiles: result.hotFiles,
    resourceChains: result.resourceChains,
  });
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}
