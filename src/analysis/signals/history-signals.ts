import simpleGit from 'simple-git';
import { dirname, relative, resolve } from 'path';
import type { ModuleInfo, ImplicitContract, ArchmapConfig } from '../../types.js';
import type { Signal } from './types.js';

/**
 * Signals derived from git history analysis.
 * Covers: co-change patterns, removed dependencies, change frequency.
 *
 * All git paths are normalized to be relative to the scan root.
 */
export async function collectHistorySignals(
  root: string,
  modules: ModuleInfo[],
  contracts: ImplicitContract[],
  config: ArchmapConfig,
): Promise<Signal[]> {
  const signals: Signal[] = [];

  // Co-change signals from existing contracts (already normalized by history-analyzer)
  signals.push(...contractsToSignals(contracts));

  // Git history deep analysis
  try {
    const git = simpleGit(root);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return signals;

    // Compute prefix for path normalization
    const gitRoot = (await git.raw(['rev-parse', '--show-toplevel']).catch(() => '')).trim().replace(/\\/g, '/');
    const absRoot = resolve(root).replace(/\\/g, '/');
    const prefix = gitRoot && absRoot !== gitRoot
      ? relative(gitRoot, absRoot).replace(/\\/g, '/') + '/'
      : '';

    signals.push(...await analyzeRemovedDependencies(git, config.gitHistory.maxCommits));
    signals.push(...await analyzeChangeFrequency(git, modules, config.gitHistory.maxCommits, prefix));
  } catch {
    // Git analysis is optional
  }

  return signals;
}

// --- Co-change Contracts → Signals ---

function contractsToSignals(contracts: ImplicitContract[]): Signal[] {
  return contracts.map((c) => ({
    kind: 'co-change' as const,
    scope: c.entities,
    strength: Math.min(0.85, c.confidence),
    description: c.description,
    context: {
      files: c.entities,
      coChangeCount: c.occurrences,
      jaccardCoefficient: c.confidence,
    },
  }));
}

// --- Removed Dependencies ---

async function analyzeRemovedDependencies(git: any, maxCommits: number): Promise<Signal[]> {
  const signals: Signal[] = [];

  try {
    // Find commits that removed import/use/from statements
    const log = await git.raw([
      'log', `--max-count=${Math.min(maxCommits, 500)}`,
      '--all', '--diff-filter=M',
      '--format=%H %s',
      '-S', 'import', // Search for commits that changed import statements
    ]);

    if (!log.trim()) return signals;

    // Parse commits and look for removed imports
    const commitLines = log.trim().split('\n').slice(0, 100); // Limit processing
    const removedDeps = new Map<string, { commit: string; message: string }>();

    for (const line of commitLines) {
      const match = line.match(/^([0-9a-f]+)\s+(.+)$/);
      if (!match) continue;

      const [, hash, message] = match;

      // Look for refactor/removal commits
      const isRemoval = /remov|delet|refactor|decouple|extract|split/i.test(message);
      if (!isRemoval) continue;

      try {
        const diff = await git.raw(['diff', `${hash}~1`, hash, '--unified=0']).catch(() => '');
        // Find removed import lines
        const removedImports = diff.split('\n')
          .filter((l: string) => l.startsWith('-') && !l.startsWith('---'))
          .filter((l: string) => /^\-\s*(import|from|use|require)/.test(l));

        if (removedImports.length > 0) {
          const key = `${hash}:removed-imports`;
          removedDeps.set(key, { commit: hash, message });
        }
      } catch { /* skip commit */ }
    }

    // Convert to signals (limit to most relevant)
    for (const [key, data] of Array.from(removedDeps.entries()).slice(0, 20)) {
      signals.push({
        kind: 'removed-dependency',
        scope: ['*'], // Broad scope — commit-level
        strength: 0.8,
        description: `Dependency was intentionally removed: "${data.message}"`,
        context: {
          removedInCommit: data.commit,
          commitMessage: data.message,
        },
      });
    }
  } catch {
    // Optional analysis
  }

  return signals;
}

// --- Change Frequency ---

async function analyzeChangeFrequency(git: any, modules: ModuleInfo[], maxCommits: number, prefix: string): Promise<Signal[]> {
  const signals: Signal[] = [];

  try {
    const log = await git.raw([
      'log', `--max-count=${maxCommits}`,
      '--numstat', '--format=%H',
    ]);

    if (!log.trim()) return signals;

    // Count changes per file
    const fileCounts = new Map<string, number>();
    const totalCommits = new Set<string>();

    for (const line of log.split('\n')) {
      const trimmed = line.trim();
      if (/^[0-9a-f]{40}$/.test(trimmed)) {
        totalCommits.add(trimmed);
        continue;
      }
      const match = trimmed.match(/^\d+\t\d+\t(.+)$/);
      if (match) {
        let fp = match[1].replace(/\\/g, '/');
        // Normalize to scan root
        if (prefix) {
          if (!fp.startsWith(prefix)) continue;
          fp = fp.slice(prefix.length);
        }
        fileCounts.set(fp, (fileCounts.get(fp) ?? 0) + 1);
      }
    }

    const commitCount = totalCommits.size || 1;

    // Aggregate to module level
    for (const mod of modules) {
      let moduleChanges = 0;
      for (const file of mod.files) {
        moduleChanges += fileCounts.get(file) ?? 0;
      }

      const frequency = moduleChanges / commitCount;

      if (frequency > 0.3) { // Changed in >30% of commits
        signals.push({
          kind: 'change-frequency',
          scope: [mod.id],
          strength: Math.min(0.7, frequency),
          description: `${mod.name} changes frequently (${Math.round(frequency * 100)}% of commits)`,
          context: { modules: [mod.id], changeFrequency: frequency },
        });

        // Cross with fan-in for hotspot detection
        const fanIn = modules.filter((m) => m.internalDependencies.includes(mod.id)).length;
        if (fanIn >= 3 && frequency > 0.2) {
          signals.push({
            kind: 'unstable-hotspot',
            scope: [mod.id],
            strength: Math.min(0.9, (frequency * fanIn) / modules.length),
            description: `${mod.name} is a hotspot: changes frequently (${Math.round(frequency * 100)}%) AND has ${fanIn} dependents`,
            context: { modules: [mod.id], changeFrequency: frequency, fanIn },
          });
        }
      }
    }
  } catch {
    // Optional
  }

  return signals;
}
