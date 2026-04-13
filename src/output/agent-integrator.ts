import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ArchmapConfig } from '../types.js';

const FENCE_START = '<!-- archmap:start -->';
const FENCE_END = '<!-- archmap:end -->';

/**
 * Integrate archmap summary into agent context files.
 * Uses fenced markers so archmap content can be surgically updated
 * without destroying manual edits.
 */
export async function integrateWithAgents(
  root: string,
  summary: string,
  config: ArchmapConfig,
): Promise<void> {
  if (config.agentIntegration.updateClaudeMd) {
    await updateFencedFile(join(root, 'CLAUDE.md'), summary);
  }

  if (config.agentIntegration.updateCursorRules) {
    await updateFencedFile(join(root, '.cursorrules'), summary);
  }
}

async function updateFencedFile(filePath: string, summary: string): Promise<void> {
  const fencedContent = `${FENCE_START}\n${summary}\n${FENCE_END}`;

  if (!existsSync(filePath)) {
    // Create the file with just the archmap content
    await writeFile(filePath, fencedContent + '\n', 'utf-8');
    return;
  }

  const existing = await readFile(filePath, 'utf-8');

  if (existing.includes(FENCE_START) && existing.includes(FENCE_END)) {
    // Replace existing fenced section
    const before = existing.substring(0, existing.indexOf(FENCE_START));
    const after = existing.substring(
      existing.indexOf(FENCE_END) + FENCE_END.length,
    );
    await writeFile(filePath, before + fencedContent + after, 'utf-8');
  } else {
    // Append fenced section
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await writeFile(filePath, existing + separator + fencedContent + '\n', 'utf-8');
  }
}
