import simpleGit from 'simple-git';
import { dirname, relative, resolve } from 'path';
import type { ImplicitContract, ArchmapConfig } from '../types.js';

interface CoChangeEntry {
  fileA: string;
  fileB: string;
  coChangeCount: number;
  totalChangesA: number;
  totalChangesB: number;
  jaccard: number;
}

/**
 * Analyze git history to detect co-change patterns.
 * Files that frequently change together likely have an implicit contract.
 *
 * Path normalization: git log returns paths relative to the git root,
 * but archmap works with paths relative to the scan root (--root).
 * We compute the prefix between them and strip/filter accordingly.
 */
export async function analyzeGitHistory(
  root: string,
  config: ArchmapConfig,
): Promise<ImplicitContract[]> {
  const git = simpleGit(root);

  // Check if we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) return [];

  // Find git root and compute prefix to normalize paths
  const gitRoot = (await git.raw(['rev-parse', '--show-toplevel']).catch(() => '')).trim().replace(/\\/g, '/');
  const absRoot = resolve(root).replace(/\\/g, '/');
  const prefix = gitRoot && absRoot !== gitRoot
    ? relative(gitRoot, absRoot).replace(/\\/g, '/') + '/'
    : '';

  // Check for shallow clone
  const revCount = await git.raw(['rev-list', '--count', 'HEAD']).catch(() => '0');
  if (parseInt(revCount.trim()) < 10) return [];

  // Get file changes per commit
  const maxCommits = config.gitHistory.maxCommits;
  const log = await git.raw([
    'log',
    `--max-count=${maxCommits}`,
    '--numstat',
    '--format=%H',
  ]).catch(() => '');

  if (!log.trim()) return [];

  // Parse commits and their changed files, normalizing paths to scan root
  const commits = parseGitLog(log, prefix);

  // Build co-change matrix
  const coChanges = buildCoChangeMatrix(commits);

  // Filter by confidence threshold
  const minConfidence = config.gitHistory.minCoChangeConfidence;
  const significant = coChanges.filter((c) => c.jaccard >= minConfidence);

  // Convert to contracts
  return significant
    .sort((a, b) => b.jaccard - a.jaccard)
    .slice(0, 50) // Top 50 contracts
    .map((entry, idx) => ({
      id: `contract-${String(idx + 1).padStart(3, '0')}`,
      type: 'co-modification' as const,
      description: `'${entry.fileA}' and '${entry.fileB}' change together ${Math.round(entry.jaccard * 100)}% of the time`,
      entities: [entry.fileA, entry.fileB],
      confidence: entry.jaccard,
      occurrences: entry.coChangeCount,
    }));
}

/**
 * Parse git log --numstat output into commit -> files map.
 * Normalizes paths: strips prefix so paths are relative to scan root.
 * Files outside the scan root are excluded.
 */
function parseGitLog(log: string, prefix: string): Map<string, string[]> {
  const commits = new Map<string, string[]>();
  let currentCommit: string | null = null;

  for (const line of log.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^[0-9a-f]{40}$/.test(trimmed)) {
      currentCommit = trimmed;
      commits.set(currentCommit, []);
      continue;
    }

    if (currentCommit) {
      const match = trimmed.match(/^\d+\t\d+\t(.+)$/);
      if (match) {
        let filePath = match[1].replace(/\\/g, '/');
        if (filePath.includes('=>') || filePath.startsWith('-')) continue;

        // Normalize: strip prefix to make path relative to scan root
        if (prefix) {
          if (!filePath.startsWith(prefix)) continue; // Outside scan root
          filePath = filePath.slice(prefix.length);
        }

        commits.get(currentCommit)!.push(filePath);
      }
    }
  }

  return commits;
}

/**
 * Build co-change matrix from commit data.
 * Uses Jaccard similarity: J(A,B) = |A∩B| / |A∪B|
 */
function buildCoChangeMatrix(commits: Map<string, string[]>): CoChangeEntry[] {
  const fileChanges = new Map<string, number>(); // file -> total commits
  const coChanges = new Map<string, number>(); // "fileA|fileB" -> co-change count

  for (const files of commits.values()) {
    // Count individual file changes
    for (const file of files) {
      fileChanges.set(file, (fileChanges.get(file) ?? 0) + 1);
    }

    // Count co-changes (pairwise, within same commit)
    // Limit to files likely in the same conceptual area
    const sourceFiles = files.filter(isSourceFile);
    for (let i = 0; i < sourceFiles.length; i++) {
      for (let j = i + 1; j < sourceFiles.length; j++) {
        // Skip pairs in the same directory (trivially co-changed)
        if (dirname(sourceFiles[i]) === dirname(sourceFiles[j])) continue;

        const key = [sourceFiles[i], sourceFiles[j]].sort().join('|');
        coChanges.set(key, (coChanges.get(key) ?? 0) + 1);
      }
    }
  }

  const results: CoChangeEntry[] = [];

  for (const [key, count] of coChanges) {
    if (count < 3) continue; // Need at least 3 co-changes

    const [fileA, fileB] = key.split('|');
    const totalA = fileChanges.get(fileA) ?? 0;
    const totalB = fileChanges.get(fileB) ?? 0;

    const jaccard = count / (totalA + totalB - count);

    results.push({
      fileA,
      fileB,
      coChangeCount: count,
      totalChangesA: totalA,
      totalChangesB: totalB,
      jaccard,
    });
  }

  return results;
}

function isSourceFile(file: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/.test(file);
}
