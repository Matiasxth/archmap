import type { ScanResult, ArchDelta } from '../types.js';

/**
 * Compare two scan results and produce an architectural delta.
 * Answers: "What changed architecturally between these two scans?"
 */
export function computeArchDelta(before: ScanResult, after: ScanResult): ArchDelta {
  // New dependencies
  const beforeEdges = new Set(before.dependencies.edges.map((e) => `${e.source}→${e.target}`));
  const afterEdges = new Set(after.dependencies.edges.map((e) => `${e.source}→${e.target}`));

  const newDependencies = after.dependencies.edges
    .filter((e) => !beforeEdges.has(`${e.source}→${e.target}`))
    .map((e) => ({ from: e.source, to: e.target }));

  const removedDependencies = before.dependencies.edges
    .filter((e) => !afterEdges.has(`${e.source}→${e.target}`))
    .map((e) => ({ from: e.source, to: e.target }));

  // New/removed modules
  const beforeModules = new Set(before.modules.map((m) => m.id));
  const afterModules = new Set(after.modules.map((m) => m.id));

  const newModules = [...afterModules].filter((m) => !beforeModules.has(m));
  const removedModules = [...beforeModules].filter((m) => !afterModules.has(m));

  // Risk changes
  const riskChanges: ArchDelta['riskChanges'] = [];
  const beforeRisks = new Map(before.fileRisks.map((r) => [r.file, r.risk]));
  for (const afterRisk of after.fileRisks) {
    const beforeRisk = beforeRisks.get(afterRisk.file);
    if (beforeRisk && beforeRisk !== afterRisk.risk) {
      riskChanges.push({ file: afterRisk.file, before: beforeRisk, after: afterRisk.risk });
    }
  }

  // Rule changes
  const beforeRuleIds = new Set(before.rules.map((r) => r.id));
  const afterRuleIds = new Set(after.rules.map((r) => r.id));
  const added = after.rules.filter((r) => !beforeRuleIds.has(r.id)).length;
  const removed = before.rules.filter((r) => !afterRuleIds.has(r.id)).length;

  let promoted = 0;
  let demoted = 0;
  for (const afterRule of after.rules) {
    const beforeRule = before.rules.find((r) => r.id === afterRule.id);
    if (!beforeRule) continue;
    const tierOrder = { observation: 0, convention: 1, rule: 2 };
    if (tierOrder[afterRule.tier] > tierOrder[beforeRule.tier]) promoted++;
    if (tierOrder[afterRule.tier] < tierOrder[beforeRule.tier]) demoted++;
  }

  return {
    newDependencies,
    removedDependencies,
    newModules,
    removedModules,
    riskChanges,
    ruleChanges: { added, removed, promoted, demoted },
  };
}
