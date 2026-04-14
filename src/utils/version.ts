import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

declare global {
  var __ARCHMAP_VERSION__: string | undefined;
}

/**
 * Get the current archmap version.
 *
 * Resolution order:
 *   1. Build-time injection via tsup define (production)
 *   2. Read package.json at runtime (dev mode via tsx)
 *
 * No hardcoded fallback — if both fail, it throws.
 */
export function getVersion(): string {
  // 1. Build-time injected by tsup
  if (typeof globalThis.__ARCHMAP_VERSION__ === 'string') {
    return globalThis.__ARCHMAP_VERSION__;
  }

  // 2. Dev mode: read package.json
  return readVersionFromPackageJson();
}

let cached: string | null = null;

function readVersionFromPackageJson(): string {
  if (cached) return cached;

  const require = createRequire(import.meta.url);
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Walk up from this file to find package.json with name "archmap"
  let dir = thisDir;
  for (let i = 0; i < 5; i++) {
    try {
      const pkgPath = join(dir, 'package.json');
      const pkg = require(pkgPath);
      if (pkg.name === 'archmap' && pkg.version) {
        cached = pkg.version as string;
        return cached;
      }
    } catch { /* continue */ }
    dir = dirname(dir);
  }

  throw new Error(
    'archmap: could not determine version. Neither build-time injection nor package.json found.',
  );
}
