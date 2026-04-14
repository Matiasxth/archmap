import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { Signal } from './types.js';

/**
 * Signals derived from existing project configuration files.
 * These represent explicit human decisions — strongest signal source.
 * Covers: eslint import rules, tsconfig paths, package.json workspaces.
 */
export async function collectConfigSignals(root: string): Promise<Signal[]> {
  const signals: Signal[] = [];

  signals.push(...await analyzeEslintConfig(root));
  signals.push(...await analyzeTsConfig(root));
  signals.push(...await analyzePackageWorkspaces(root));

  return signals;
}

// --- ESLint Import Rules ---

async function analyzeEslintConfig(root: string): Promise<Signal[]> {
  const signals: Signal[] = [];
  const eslintFiles = ['.eslintrc.json', '.eslintrc.js', '.eslintrc.yml', '.eslintrc', 'eslint.config.js', 'eslint.config.mjs'];

  for (const file of eslintFiles) {
    const filePath = join(root, file);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, 'utf-8');

      // Look for import restriction rules
      if (content.includes('no-restricted-imports') || content.includes('import/no-internal-modules') || content.includes('boundaries/element-types')) {
        signals.push({
          kind: 'config-boundary',
          scope: ['*'],
          strength: 0.95, // Explicit human decision = very strong
          description: `ESLint import restrictions found in ${file} — team has defined module boundaries`,
          context: { configFile: file, configRule: 'import-restrictions' },
        });
      }

      // Look for no-restricted-paths patterns
      const restrictedMatch = content.match(/no-restricted-imports|no-restricted-paths/g);
      if (restrictedMatch) {
        signals.push({
          kind: 'config-boundary',
          scope: ['*'],
          strength: 0.95,
          description: `${file} contains ${restrictedMatch.length} import restriction rule(s)`,
          context: { configFile: file, configRule: 'no-restricted-imports' },
        });
      }
    } catch { /* skip */ }
  }

  return signals;
}

// --- TSConfig Path Restrictions ---

async function analyzeTsConfig(root: string): Promise<Signal[]> {
  const signals: Signal[] = [];
  const tsconfigPath = join(root, 'tsconfig.json');

  if (!existsSync(tsconfigPath)) return signals;

  try {
    const content = await readFile(tsconfigPath, 'utf-8');
    const tsconfig = JSON.parse(content);

    // Check for path aliases — these define module boundaries
    const paths = tsconfig.compilerOptions?.paths;
    if (paths && Object.keys(paths).length > 0) {
      const aliases = Object.keys(paths);
      signals.push({
        kind: 'config-boundary',
        scope: aliases.map((a) => a.replace('/*', '')),
        strength: 0.7,
        description: `tsconfig.json defines ${aliases.length} path alias(es): ${aliases.slice(0, 5).join(', ')}`,
        context: { configFile: 'tsconfig.json', configRule: 'paths', details: { aliases } },
      });
    }

    // Check for project references (monorepo boundaries)
    if (tsconfig.references && tsconfig.references.length > 0) {
      signals.push({
        kind: 'config-boundary',
        scope: tsconfig.references.map((r: any) => r.path),
        strength: 0.9,
        description: `tsconfig.json defines ${tsconfig.references.length} project reference(s) — explicit module boundaries`,
        context: { configFile: 'tsconfig.json', configRule: 'references' },
      });
    }
  } catch { /* skip */ }

  return signals;
}

// --- Package.json Workspaces ---

async function analyzePackageWorkspaces(root: string): Promise<Signal[]> {
  const signals: Signal[] = [];
  const pkgPath = join(root, 'package.json');

  if (!existsSync(pkgPath)) return signals;

  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));

    if (pkg.workspaces) {
      const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages ?? [];
      if (workspaces.length > 0) {
        signals.push({
          kind: 'config-boundary',
          scope: workspaces,
          strength: 0.9,
          description: `package.json defines ${workspaces.length} workspace(s) — explicit package boundaries`,
          context: { configFile: 'package.json', configRule: 'workspaces', details: { workspaces } },
        });
      }
    }
  } catch { /* skip */ }

  return signals;
}
