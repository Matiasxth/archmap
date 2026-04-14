import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

let cachedVersion: string | null = null;

/**
 * Get the current archmap version from package.json.
 * Single source of truth — no hardcoded version strings.
 */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    // Try reading from package.json relative to this file
    const paths = [
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
      join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
      join(process.cwd(), 'package.json'),
    ];

    for (const p of paths) {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.name === 'archmap' && pkg.version) {
          cachedVersion = pkg.version;
          return cachedVersion!;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }

  cachedVersion = '0.5.0';
  return cachedVersion;
}
