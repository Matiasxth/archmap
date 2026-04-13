import { basename, dirname } from 'path';
import type { ModuleInfo, DependencyGraph, ArchRule, ParseResult } from '../types.js';

/**
 * Infer architectural rules from static analysis and module structure.
 */
export function inferRules(
  modules: ModuleInfo[],
  graph: DependencyGraph,
  parseResults: ParseResult[],
): ArchRule[] {
  const rules: ArchRule[] = [];
  let ruleIdx = 0;

  // 1. Boundary rules: detect modules that never import each other
  rules.push(...inferBoundaryRules(modules, ++ruleIdx));

  // 2. Naming convention rules
  rules.push(...inferNamingRules(parseResults, ruleIdx));
  ruleIdx += rules.length;

  // Re-number
  return rules.map((r, i) => ({
    ...r,
    id: `rule-${String(i + 1).padStart(3, '0')}`,
  }));
}

function inferBoundaryRules(modules: ModuleInfo[], startIdx: number): ArchRule[] {
  const rules: ArchRule[] = [];

  // For each pair of modules, check if there's a one-way dependency
  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const a = modules[i];
      const b = modules[j];

      const aImportsB = a.internalDependencies.includes(b.id);
      const bImportsA = b.internalDependencies.includes(a.id);

      // One-way dependency = potential boundary rule
      if (aImportsB && !bImportsA) {
        rules.push({
          id: '',
          type: 'boundary',
          confidence: 0.85,
          description: `'${b.name}' is never imported by '${a.name}' in reverse — dependency is one-directional`,
          source: 'static-analysis',
          evidence: {
            from: a.id,
            to: b.id,
            direction: 'unidirectional',
          },
        });
      }

      // No dependency at all between two modules
      if (!aImportsB && !bImportsA && modules.length > 3) {
        rules.push({
          id: '',
          type: 'boundary',
          confidence: 0.75,
          description: `'${a.name}' and '${b.name}' are completely independent — no imports between them`,
          source: 'static-analysis',
          evidence: {
            moduleA: a.id,
            moduleB: b.id,
            relationship: 'independent',
          },
        });
      }
    }
  }

  return rules;
}

function inferNamingRules(parseResults: ParseResult[], startIdx: number): ArchRule[] {
  const rules: ArchRule[] = [];

  // Group files by directory
  const dirFiles = new Map<string, string[]>();
  for (const result of parseResults) {
    const dir = dirname(result.filePath);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir)!.push(basename(result.filePath));
  }

  // Check each directory for naming patterns
  for (const [dir, files] of dirFiles) {
    if (files.length < 3) continue;

    // Check for suffix patterns like *.controller.ts, *.service.ts
    const suffixPattern = detectSuffixPattern(files);
    if (suffixPattern) {
      const matchCount = files.filter((f) =>
        f.match(suffixPattern.regex),
      ).length;
      const confidence = matchCount / files.length;

      if (confidence >= 0.75) {
        rules.push({
          id: '',
          type: 'naming-convention',
          confidence,
          description: `Files in '${dir}/' follow the '${suffixPattern.pattern}' naming pattern`,
          source: 'static-analysis',
          evidence: {
            directory: dir,
            pattern: suffixPattern.pattern,
            matchingFiles: matchCount,
            totalFiles: files.length,
            exceptions: files.filter((f) => !f.match(suffixPattern.regex)),
          },
        });
      }
    }
  }

  return rules;
}

interface SuffixPatternResult {
  pattern: string;
  regex: RegExp;
}

function detectSuffixPattern(files: string[]): SuffixPatternResult | null {
  // Extract double-suffixes like .controller.ts, .service.ts
  const suffixes = new Map<string, number>();

  for (const file of files) {
    const match = file.match(/\.([a-z]+)\.[a-z]+$/);
    if (match) {
      const suffix = match[1];
      suffixes.set(suffix, (suffixes.get(suffix) ?? 0) + 1);
    }
  }

  // Find dominant suffix
  let bestSuffix = '';
  let bestCount = 0;
  for (const [suffix, count] of suffixes) {
    if (count > bestCount) {
      bestSuffix = suffix;
      bestCount = count;
    }
  }

  if (bestCount >= 2 && bestCount / files.length >= 0.5) {
    return {
      pattern: `*.${bestSuffix}.*`,
      regex: new RegExp(`\\.${bestSuffix}\\.[a-z]+$`),
    };
  }

  return null;
}
