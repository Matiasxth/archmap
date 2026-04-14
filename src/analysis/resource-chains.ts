import { basename } from 'path';
import type { ParseResult, ResourceChain, ResourceChainLink } from '../types.js';

/**
 * Detect resource chains across the codebase.
 * Groups files by resource name and builds ordered chains.
 */
export function detectResourceChains(parseResults: ParseResult[]): ResourceChain[] {
  const resourceMap = new Map<string, ResourceChainLink[]>();

  for (const result of parseResults) {
    const resource = extractResourceName(result.filePath);
    if (!resource) continue;

    const role = detectRole(result.filePath);
    if (role === 'other') continue;

    if (!resourceMap.has(resource)) resourceMap.set(resource, []);
    resourceMap.get(resource)!.push({
      file: result.filePath,
      role,
      language: result.language,
    });
  }

  const chains: ResourceChain[] = [];

  for (const [resource, links] of resourceMap) {
    // Need at least 2 different roles
    const roles = new Set(links.map((l) => l.role));
    if (roles.size < 2) continue;

    const ordered = orderChain(links);
    const languages = [...new Set(ordered.map((l) => l.language))];

    chains.push({
      resource,
      links: ordered,
      languages,
      isCrossStack: languages.length > 1,
    });
  }

  return chains.sort((a, b) => b.links.length - a.links.length);
}

const ROLE_ORDER = ['model', 'schema', 'migration', 'service', 'api', 'hook', 'store', 'page', 'component', 'test'];

function orderChain(links: ResourceChainLink[]): ResourceChainLink[] {
  const seen = new Set<string>();
  return links
    .filter((l) => {
      if (seen.has(l.role)) return false;
      seen.add(l.role);
      return ROLE_ORDER.includes(l.role);
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

function extractResourceName(file: string): string | null {
  const name = basename(file).replace(/\.[^.]+$/, '');

  if (['index', 'main', 'app', 'config', 'utils', 'helpers', 'constants', 'types',
       'mod', 'lib', '__init__', 'setup', 'conftest', 'env', 'theme', 'router',
       'middleware', 'database', 'connection', 'logger', 'auth'].includes(name.toLowerCase())) {
    return null;
  }

  let resource = name;
  resource = resource.replace(/^(use|get|create|update|delete|fetch|post|put|patch)/i, '');
  resource = resource.replace(/(Service|Controller|Handler|Routes?|Router|Page|View|Component|Model|Schema|Repository|Store|Hook|Resolver|Module|Provider|Factory|Manager|Client|Api|Layout)$/i, '');
  resource = resource.replace(/_service$|_controller$|_handler$|_model$|_schema$|_repository$|_routes?$|_test$|\.test$|\.spec$/i, '');

  resource = resource.toLowerCase().trim();
  if (resource.endsWith('ies')) resource = resource.slice(0, -3) + 'y';
  else if (resource.endsWith('ses')) resource = resource.slice(0, -2);
  else if (resource.endsWith('s') && !resource.endsWith('ss')) resource = resource.slice(0, -1);

  if (resource.length < 3) return null;
  return resource;
}

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
  if (lower.includes('/migrations/') || lower.includes('/alembic/versions/')) return 'migration';
  return 'other';
}
