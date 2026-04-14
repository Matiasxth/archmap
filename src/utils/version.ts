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
 * This ensures version drift is caught immediately, not silently wrong.
 */
export function getVersion(): string {
  // 1. Build-time injected by tsup
  if (typeof globalThis.__ARCHMAP_VERSION__ === 'string') {
    return globalThis.__ARCHMAP_VERSION__;
  }

  // 2. Dev mode: read package.json (synchronous, cached)
  return readVersionFromPackageJson();
}

let cached: string | null = null;

function readVersionFromPackageJson(): string {
  if (cached) return cached;

  const { readFileSync } = require('fs');
  const { join, dirname } = require('path');

  // Walk up from this file to find package.json with name "archmap"
  let dir = __dirname ?? dirname(new URL(import.meta.url).pathname);

  for (let i = 0; i < 5; i++) {
    try {
      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name === 'archmap' && pkg.version) {
        cached = pkg.version as string;
        return cached;
      }
    } catch { /* continue */ }
    dir = dirname(dir);
  }

  throw new Error(
    'archmap: could not determine version. Neither build-time injection nor package.json found. ' +
    'This is a build configuration error — please report it.',
  );
}
