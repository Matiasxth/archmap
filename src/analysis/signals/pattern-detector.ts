import type { ModuleInfo, DependencyGraph } from '../../types.js';
import type { Signal, ArchPattern, ArchPatternLayer, ArchPatternRule } from './types.js';

/**
 * Detect known architectural patterns in the project.
 * Generates strong signals when a pattern is confirmed.
 */
export function detectArchPattern(
  modules: ModuleInfo[],
  graph: DependencyGraph,
): { pattern: ArchPattern | null; signals: Signal[] } {
  const moduleNames = modules.map((m) => m.name.toLowerCase());
  const moduleIds = modules.map((m) => m.id);

  // Try each pattern, pick the best match
  const candidates = [
    detectCleanArchitecture(modules, moduleNames, moduleIds),
    detectMVC(modules, moduleNames, moduleIds),
    detectHexagonal(modules, moduleNames, moduleIds),
    detectFeatureBased(modules, moduleNames, moduleIds),
    detectLayered(modules, moduleNames, moduleIds),
  ].filter((c) => c !== null) as Array<{ pattern: ArchPattern; signals: Signal[] }>;

  if (candidates.length === 0) return { pattern: null, signals: [] };

  // Pick highest confidence
  candidates.sort((a, b) => b.pattern.confidence - a.pattern.confidence);
  return candidates[0];
}

// --- Clean Architecture ---

function detectCleanArchitecture(
  modules: ModuleInfo[], names: string[], ids: string[],
): { pattern: ArchPattern; signals: Signal[] } | null {
  const domainKeywords = ['domain', 'entities', 'core', 'models'];
  const appKeywords = ['application', 'services', 'use-cases', 'usecases', 'interactors'];
  const infraKeywords = ['infrastructure', 'infra', 'adapters', 'repositories', 'db', 'database'];
  const interfaceKeywords = ['interfaces', 'controllers', 'routes', 'handlers', 'api', 'presentation'];

  const domain = findModules(modules, names, domainKeywords);
  const app = findModules(modules, names, appKeywords);
  const infra = findModules(modules, names, infraKeywords);
  const iface = findModules(modules, names, interfaceKeywords);

  const matchedLayers = [domain, app, infra, iface].filter((l) => l.length > 0).length;
  if (matchedLayers < 2) return null;

  const confidence = matchedLayers / 4;
  const layers: ArchPatternLayer[] = [];
  const rules: ArchPatternRule[] = [];
  const signals: Signal[] = [];

  if (domain.length > 0) layers.push({ name: 'domain', modules: domain.map((m) => m.id), level: 0 });
  if (app.length > 0) layers.push({ name: 'application', modules: app.map((m) => m.id), level: 1 });
  if (infra.length > 0) layers.push({ name: 'infrastructure', modules: infra.map((m) => m.id), level: 2 });
  if (iface.length > 0) layers.push({ name: 'interface', modules: iface.map((m) => m.id), level: 2 });

  // Core rule: domain must not depend on infrastructure or interface
  if (domain.length > 0 && infra.length > 0) {
    rules.push({ description: 'Domain must not depend on infrastructure', from: 'domain', to: 'infrastructure', direction: 'forbidden' });
    for (const d of domain) {
      for (const i of infra) {
        signals.push({
          kind: 'arch-pattern-match',
          scope: [d.id, i.id],
          strength: confidence * 0.9,
          description: `Clean Architecture: ${d.name} (domain) must not depend on ${i.name} (infrastructure)`,
          context: { detectedPattern: 'clean-architecture', patternConfidence: confidence, expectedRule: 'domain → infrastructure: forbidden' },
        });
      }
    }
  }

  if (domain.length > 0 && iface.length > 0) {
    rules.push({ description: 'Domain must not depend on interface layer', from: 'domain', to: 'interface', direction: 'forbidden' });
    for (const d of domain) {
      for (const i of iface) {
        signals.push({
          kind: 'arch-pattern-match',
          scope: [d.id, i.id],
          strength: confidence * 0.9,
          description: `Clean Architecture: ${d.name} (domain) must not depend on ${i.name} (interface)`,
          context: { detectedPattern: 'clean-architecture', patternConfidence: confidence, expectedRule: 'domain → interface: forbidden' },
        });
      }
    }
  }

  if (infra.length > 0 && app.length > 0) {
    rules.push({ description: 'Infrastructure should not depend on application', from: 'infrastructure', to: 'application', direction: 'forbidden' });
  }

  return {
    pattern: { name: 'clean-architecture', confidence, layers, rules },
    signals,
  };
}

// --- MVC ---

function detectMVC(
  modules: ModuleInfo[], names: string[], ids: string[],
): { pattern: ArchPattern; signals: Signal[] } | null {
  const modelKeywords = ['models', 'model', 'entities', 'schemas'];
  const viewKeywords = ['views', 'view', 'templates', 'pages', 'components'];
  const controllerKeywords = ['controllers', 'controller', 'handlers', 'routes'];

  const model = findModules(modules, names, modelKeywords);
  const view = findModules(modules, names, viewKeywords);
  const controller = findModules(modules, names, controllerKeywords);

  const matchedLayers = [model, view, controller].filter((l) => l.length > 0).length;
  if (matchedLayers < 2) return null;

  const confidence = matchedLayers / 3;
  const signals: Signal[] = [];

  // MVC rule: views should not import models directly
  if (view.length > 0 && model.length > 0) {
    for (const v of view) {
      for (const m of model) {
        signals.push({
          kind: 'arch-pattern-match',
          scope: [v.id, m.id],
          strength: confidence * 0.7,
          description: `MVC: ${v.name} (view) should not import directly from ${m.name} (model) — use controllers`,
          context: { detectedPattern: 'mvc', patternConfidence: confidence, expectedRule: 'view → model: discouraged' },
        });
      }
    }
  }

  return {
    pattern: {
      name: 'mvc', confidence,
      layers: [
        ...(model.length > 0 ? [{ name: 'model', modules: model.map((m) => m.id), level: 0 }] : []),
        ...(controller.length > 0 ? [{ name: 'controller', modules: controller.map((m) => m.id), level: 1 }] : []),
        ...(view.length > 0 ? [{ name: 'view', modules: view.map((m) => m.id), level: 2 }] : []),
      ],
      rules: [],
    },
    signals,
  };
}

// --- Hexagonal ---

function detectHexagonal(
  modules: ModuleInfo[], names: string[], ids: string[],
): { pattern: ArchPattern; signals: Signal[] } | null {
  const coreKeywords = ['core', 'domain', 'app'];
  const portKeywords = ['ports', 'port', 'interfaces'];
  const adapterKeywords = ['adapters', 'adapter', 'driven', 'driving'];

  const core = findModules(modules, names, coreKeywords);
  const ports = findModules(modules, names, portKeywords);
  const adapters = findModules(modules, names, adapterKeywords);

  const matchedLayers = [core, ports, adapters].filter((l) => l.length > 0).length;
  if (matchedLayers < 2 || ports.length === 0) return null;

  const confidence = matchedLayers / 3;
  const signals: Signal[] = [];

  // Hexagonal: adapters must not be imported by core
  if (core.length > 0 && adapters.length > 0) {
    for (const c of core) {
      for (const a of adapters) {
        signals.push({
          kind: 'arch-pattern-match',
          scope: [c.id, a.id],
          strength: confidence * 0.85,
          description: `Hexagonal: ${c.name} (core) must not depend on ${a.name} (adapter)`,
          context: { detectedPattern: 'hexagonal', patternConfidence: confidence, expectedRule: 'core → adapter: forbidden' },
        });
      }
    }
  }

  return {
    pattern: {
      name: 'hexagonal', confidence,
      layers: [
        ...(core.length > 0 ? [{ name: 'core', modules: core.map((m) => m.id), level: 0 }] : []),
        ...(ports.length > 0 ? [{ name: 'ports', modules: ports.map((m) => m.id), level: 1 }] : []),
        ...(adapters.length > 0 ? [{ name: 'adapters', modules: adapters.map((m) => m.id), level: 2 }] : []),
      ],
      rules: [],
    },
    signals,
  };
}

// --- Feature-Based ---

function detectFeatureBased(
  modules: ModuleInfo[], names: string[], ids: string[],
): { pattern: ArchPattern; signals: Signal[] } | null {
  // Feature-based: each module is self-contained, low cross-module deps
  if (modules.length < 3) return null;

  const avgDeps = modules.reduce((sum, m) => sum + m.internalDependencies.length, 0) / modules.length;
  const maxDeps = modules.length - 1;

  if (avgDeps / maxDeps > 0.3) return null; // Too interconnected

  const confidence = 1 - (avgDeps / maxDeps);
  if (confidence < 0.5) return null;

  return {
    pattern: {
      name: 'feature-based', confidence,
      layers: modules.map((m, i) => ({ name: m.name, modules: [m.id], level: 0 })),
      rules: [],
    },
    signals: [{
      kind: 'arch-pattern-match',
      scope: modules.map((m) => m.id),
      strength: confidence * 0.5,
      description: `Project appears feature-based: modules are loosely coupled (avg ${avgDeps.toFixed(1)} deps)`,
      context: { detectedPattern: 'feature-based', patternConfidence: confidence },
    }],
  };
}

// --- Generic Layered ---

function detectLayered(
  modules: ModuleInfo[], names: string[], ids: string[],
): { pattern: ArchPattern; signals: Signal[] } | null {
  const uiKeywords = ['ui', 'views', 'pages', 'components', 'frontend'];
  const serviceKeywords = ['services', 'service', 'logic', 'business'];
  const dataKeywords = ['data', 'db', 'database', 'repository', 'repositories', 'store', 'stores'];

  const ui = findModules(modules, names, uiKeywords);
  const service = findModules(modules, names, serviceKeywords);
  const data = findModules(modules, names, dataKeywords);

  const matchedLayers = [ui, service, data].filter((l) => l.length > 0).length;
  if (matchedLayers < 2) return null;

  const confidence = matchedLayers / 3 * 0.8;

  return {
    pattern: {
      name: 'layered', confidence,
      layers: [
        ...(data.length > 0 ? [{ name: 'data', modules: data.map((m) => m.id), level: 0 }] : []),
        ...(service.length > 0 ? [{ name: 'service', modules: service.map((m) => m.id), level: 1 }] : []),
        ...(ui.length > 0 ? [{ name: 'ui', modules: ui.map((m) => m.id), level: 2 }] : []),
      ],
      rules: [],
    },
    signals: [],
  };
}

// --- Helpers ---

function findModules(modules: ModuleInfo[], names: string[], keywords: string[]): ModuleInfo[] {
  return modules.filter((m, i) => keywords.some((k) => names[i].includes(k)));
}
