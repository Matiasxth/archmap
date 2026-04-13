import { writeFile, readFile, unlink, chmod } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const HOOK_MARKER = '# archmap-managed-hook';
const HOOK_CONTENT = `#!/bin/sh
${HOOK_MARKER}
# Auto-scan architecture on commit
npx archmap scan --no-git-history 2>/dev/null || true
`;

export async function installHook(root: string): Promise<void> {
  const hooksDir = join(root, '.git', 'hooks');

  if (!existsSync(join(root, '.git'))) {
    throw new Error('Not a git repository. Run `git init` first.');
  }

  const hookPath = join(hooksDir, 'pre-commit');

  if (existsSync(hookPath)) {
    const existing = await readFile(hookPath, 'utf-8');

    if (existing.includes(HOOK_MARKER)) {
      return; // Already installed
    }

    // Append to existing hook
    const updated = existing.trimEnd() + '\n\n' + HOOK_CONTENT;
    await writeFile(hookPath, updated, 'utf-8');
  } else {
    await writeFile(hookPath, HOOK_CONTENT, 'utf-8');
  }

  // Make executable (Unix)
  try {
    await chmod(hookPath, 0o755);
  } catch {
    // Ignore on Windows
  }
}

export async function removeHook(root: string): Promise<void> {
  const hookPath = join(root, '.git', 'hooks', 'pre-commit');

  if (!existsSync(hookPath)) return;

  const content = await readFile(hookPath, 'utf-8');

  if (!content.includes(HOOK_MARKER)) {
    throw new Error('Hook was not installed by archmap. Remove manually.');
  }

  // If the entire hook is just our content, remove the file
  const lines = content.split('\n');
  const archmapStart = lines.findIndex((l) => l.includes(HOOK_MARKER));

  if (archmapStart <= 1) {
    // Our hook is the only content
    await unlink(hookPath);
  } else {
    // Remove just our section
    const cleaned = lines.slice(0, archmapStart - 1).join('\n');
    await writeFile(hookPath, cleaned, 'utf-8');
  }
}
