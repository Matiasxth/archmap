import { basename, dirname } from 'path';
import type { ParseResult } from '../../types.js';
import type { Signal } from './types.js';

/**
 * Cross-stack signals: detect relationships between files in different
 * languages/stacks that share a resource name.
 *
 * Examples:
 *   backend/app/api/luminaires.py  ↔  frontend/src/hooks/api/useLuminaires.ts
 *   backend/app/models/crew.py     ↔  backend/app/schemas/crew.py
 *   backend/app/services/X_service.py ↔ backend/app/api/X.py
 *
 * This is opt-in via config because it assumes naming conventions.
 */
export function collectCrossStackSignals(parseResults: ParseResult[]): Signal[] {
  const signals: Signal[] = [];
  const files = parseResults.map((r) => r.filePath);

  // Extract resource name from each file
  const resourceMap = new Map<string, Array<{ file: string; role: string; language: string }>>();

  for (const file of files) {
    const resource = extractResourceName(file);
    if (!resource) continue;

    const role = detectRole(file);
    const language = file.endsWith('.py') ? 'python'
      : file.endsWith('.go') ? 'go'
      : file.endsWith('.rs') ? 'rust'
      : file.endsWith('.java') ? 'java'
      : 'typescript';

    if (!resourceMap.has(resource)) resourceMap.set(resource, []);
    resourceMap.get(resource)!.push({ file, role, language });
  }

  // Generate signals for resources that appear in multiple roles/languages
  for (const [resource, entries] of resourceMap) {
    if (entries.length < 2) continue;

    const roles = new Set(entries.map((e) => e.role));
    const languages = new Set(entries.map((e) => e.language));

    // Cross-language pair (e.g., Python backend + TypeScript frontend)
    if (languages.size > 1) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[i].language === entries[j].language) continue;

          signals.push({
            kind: 'co-change',
            scope: [entries[i].file, entries[j].file],
            strength: 0.7,
            description: `Cross-stack: '${basename(entries[i].file)}' (${entries[i].role}) and '${basename(entries[j].file)}' (${entries[j].role}) share resource '${resource}'`,
            context: {
              files: [entries[i].file, entries[j].file],
              details: { resource, crossStack: true, roles: [entries[i].role, entries[j].role] },
            },
          });
        }
      }
    }

    // Same-language chain (model → schema → service → api)
    if (roles.size >= 2) {
      const chain = buildChain(entries);
      if (chain.length >= 2) {
        for (let i = 0; i < chain.length - 1; i++) {
          signals.push({
            kind: 'co-change',
            scope: [chain[i].file, chain[i + 1].file],
            strength: 0.65,
            description: `Resource chain '${resource}': '${basename(chain[i].file)}' (${chain[i].role}) → '${basename(chain[i + 1].file)}' (${chain[i + 1].role})`,
            context: {
              files: [chain[i].file, chain[i + 1].file],
              details: { resource, chainLink: true, roles: [chain[i].role, chain[i + 1].role] },
            },
          });
        }
      }
    }
  }

  return signals;
}

/**
 * Extract a resource name from a file path.
 * Strips common prefixes/suffixes to find the core concept.
 *
 * "backend/app/api/luminaires.py"          → "luminaire"
 * "frontend/src/hooks/api/useLuminaires.ts" → "luminaire"
 * "backend/app/services/crew_service.py"   → "crew"
 * "backend/app/models/project.py"          → "project"
 * "src/pages/admin/CrewsPage.tsx"          → "crew"
 */
function extractResourceName(file: string): string | null {
  const name = basename(file).replace(/\.[^.]+$/, ''); // strip extension

  // Skip non-resource files
  if (['index', 'main', 'app', 'config', 'utils', 'helpers', 'constants', 'types',
       'mod', 'lib', '__init__', 'setup', 'conftest', 'env'].includes(name.toLowerCase())) {
    return null;
  }

  let resource = name;

  // Strip common prefixes
  resource = resource.replace(/^(use|get|create|update|delete|fetch|post|put|patch)/i, '');

  // Strip common suffixes
  resource = resource.replace(/(Service|Controller|Handler|Routes?|Router|Page|View|Component|Model|Schema|Repository|Store|Hook|Resolver|Module|Provider|Factory|Manager|Client|Api)$/i, '');
  resource = resource.replace(/_service$|_controller$|_handler$|_model$|_schema$|_repository$|_routes?$|_test$|\.test$|\.spec$/i, '');

  // Normalize: lowercase, singularize simple plurals
  resource = resource.toLowerCase().trim();
  if (resource.endsWith('ies')) resource = resource.slice(0, -3) + 'y';
  else if (resource.endsWith('ses')) resource = resource.slice(0, -2);
  else if (resource.endsWith('s') && !resource.endsWith('ss')) resource = resource.slice(0, -1);

  // Skip too-short or empty names
  if (resource.length < 3) return null;

  return resource;
}

/**
 * Detect the role of a file from its path.
 */
function detectRole(file: string): string {
  const lower = file.toLowerCase();

  if (lower.includes('/models/') || lower.includes('/model/') || lower.includes('/entities/')) return 'model';
  if (lower.includes('/schemas/') || lower.includes('/schema/') || lower.includes('/dto/')) return 'schema';
  if (lower.includes('/services/') || lower.includes('/service/') || lower.includes('/usecases/')) return 'service';
  if (lower.includes('/api/') || lower.includes('/routes/') || lower.includes('/controllers/') || lower.includes('/handlers/')) return 'api';
  if (lower.includes('/hooks/')) return 'hook';
  if (lower.includes('/pages/') || lower.includes('/views/') || lower.includes('/screens/')) return 'page';
  if (lower.includes('/components/')) return 'component';
  if (lower.includes('/stores/') || lower.includes('/store/')) return 'store';
  if (lower.includes('/test') || lower.includes('__test')) return 'test';
  if (lower.includes('/migrations/') || lower.includes('/alembic/')) return 'migration';

  return 'other';
}

/**
 * Build an ordered chain from entries by role.
 * Order: model → schema → service → api → hook → store → page → component
 */
function buildChain(entries: Array<{ file: string; role: string; language: string }>): Array<{ file: string; role: string }> {
  const roleOrder = ['model', 'schema', 'migration', 'service', 'api', 'hook', 'store', 'page', 'component'];
  const seen = new Set<string>();

  return entries
    .filter((e) => {
      if (seen.has(e.role)) return false;
      seen.add(e.role);
      return roleOrder.includes(e.role);
    })
    .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
}
