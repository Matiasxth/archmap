import simpleGit from 'simple-git';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

interface ScanCache {
  lastCommit: string;
  lastScanAt: string;
  fileHashes: Record<string, string>; // relativePath -> last known commit hash
}

const CACHE_FILE = '.archmap/cache.json';

/**
 * Get list of files that changed since the last scan.
 * If no cache exists, returns null (meaning: do a full scan).
 */
export async function getChangedFiles(root: string): Promise<string[] | null> {
  const cachePath = join(root, CACHE_FILE);

  if (!existsSync(cachePath)) return null;

  try {
    const cache: ScanCache = JSON.parse(await readFile(cachePath, 'utf-8'));
    const git = simpleGit(root);

    // Check if the cached commit still exists
    const isValid = await git.raw(['cat-file', '-t', cache.lastCommit]).catch(() => null);
    if (!isValid) return null;

    // Get files changed since last scan commit
    const diff = await git.raw(['diff', '--name-only', cache.lastCommit, 'HEAD']).catch(() => '');
    const stagedDiff = await git.raw(['diff', '--name-only', '--cached']).catch(() => '');
    const untrackedRaw = await git.raw(['ls-files', '--others', '--exclude-standard']).catch(() => '');

    const allChanged = new Set<string>();

    for (const line of [...diff.split('\n'), ...stagedDiff.split('\n'), ...untrackedRaw.split('\n')]) {
      const trimmed = line.trim();
      if (trimmed) allChanged.add(trimmed);
    }

    return [...allChanged];
  } catch {
    return null; // Fall back to full scan
  }
}

/**
 * Save scan cache after a successful scan.
 */
export async function saveScanCache(root: string): Promise<void> {
  const cachePath = join(root, CACHE_FILE);
  const git = simpleGit(root);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return;

    const headCommit = (await git.raw(['rev-parse', 'HEAD']).catch(() => '')).trim();
    if (!headCommit) return;

    const cache: ScanCache = {
      lastCommit: headCommit,
      lastScanAt: new Date().toISOString(),
      fileHashes: {},
    };

    await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // Cache save is optional — don't fail the scan
  }
}
