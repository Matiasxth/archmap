import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';

/**
 * Regex-based TypeScript/JavaScript parser.
 * Extracts imports and exports without requiring tree-sitter WASM.
 * Handles: ESM imports, CJS require, dynamic imports, re-exports,
 * named exports, default exports, and type exports.
 */
export function parseTypeScript(content: string, filePath: string): ParseResult {
  const lines = content.split('\n');
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // ESM imports: import { foo, bar } from 'module'
    // import foo from 'module'
    // import * as foo from 'module'
    // import 'module'
    // import type { Foo } from 'module'
    const importMatch = line.match(
      /import\s+(?:type\s+)?(?:({[^}]+}|\*\s+as\s+\w+|\w+)(?:\s*,\s*({[^}]+}|\*\s+as\s+\w+))?\s+from\s+)?['"](.[^'"]*)['"]/,
    );
    if (importMatch) {
      const source = importMatch[3];
      const specifiers = extractSpecifiers(importMatch[1], importMatch[2]);
      imports.push({
        source,
        specifiers,
        isRelative: source.startsWith('.') || source.startsWith('/'),
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // CJS require: const foo = require('module')
    const requireMatch = line.match(
      /(?:const|let|var)\s+(?:{([^}]+)}|(\w+))\s*=\s*require\s*\(\s*['"](.[^'"]*)['"]\s*\)/,
    );
    if (requireMatch) {
      const source = requireMatch[3];
      const specifiers = requireMatch[1]
        ? requireMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        : requireMatch[2]
          ? [requireMatch[2]]
          : [];
      imports.push({
        source,
        specifiers,
        isRelative: source.startsWith('.') || source.startsWith('/'),
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // Dynamic import: import('module') or await import('module')
    const dynamicMatch = line.match(/import\s*\(\s*['"](.[^'"]*)['"]\s*\)/);
    if (dynamicMatch && !importMatch) {
      imports.push({
        source: dynamicMatch[1],
        specifiers: [],
        isRelative: dynamicMatch[1].startsWith('.') || dynamicMatch[1].startsWith('/'),
        isDynamic: true,
        line: lineNum,
      });
    }

    // Re-exports: export { foo, bar } from 'module'
    const reExportMatch = line.match(
      /export\s+(?:type\s+)?{([^}]+)}\s+from\s+['"](.[^'"]*)['"]/,
    );
    if (reExportMatch) {
      const source = reExportMatch[2];
      const specifiers = reExportMatch[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);

      imports.push({
        source,
        specifiers,
        isRelative: source.startsWith('.') || source.startsWith('/'),
        isDynamic: false,
        line: lineNum,
      });

      for (const spec of specifiers) {
        exports.push({ name: spec, type: 'unknown', line: lineNum });
      }
      continue;
    }

    // export * from 'module'
    const reExportAllMatch = line.match(
      /export\s+\*\s+(?:as\s+(\w+)\s+)?from\s+['"](.[^'"]*)['"]/,
    );
    if (reExportAllMatch) {
      imports.push({
        source: reExportAllMatch[2],
        specifiers: ['*'],
        isRelative: reExportAllMatch[2].startsWith('.') || reExportAllMatch[2].startsWith('/'),
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // Named exports
    // export function foo()
    const exportFnMatch = line.match(
      /export\s+(?:async\s+)?function\s+(\w+)/,
    );
    if (exportFnMatch) {
      exports.push({ name: exportFnMatch[1], type: 'function', line: lineNum });
      continue;
    }

    // export class Foo
    const exportClassMatch = line.match(/export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (exportClassMatch) {
      exports.push({ name: exportClassMatch[1], type: 'class', line: lineNum });
      continue;
    }

    // export interface Foo
    const exportInterfaceMatch = line.match(/export\s+interface\s+(\w+)/);
    if (exportInterfaceMatch) {
      exports.push({ name: exportInterfaceMatch[1], type: 'interface', line: lineNum });
      continue;
    }

    // export type Foo
    const exportTypeMatch = line.match(/export\s+type\s+(\w+)/);
    if (exportTypeMatch) {
      exports.push({ name: exportTypeMatch[1], type: 'type', line: lineNum });
      continue;
    }

    // export const/let/var foo
    const exportConstMatch = line.match(
      /export\s+(?:const|let|var)\s+(\w+)/,
    );
    if (exportConstMatch) {
      exports.push({ name: exportConstMatch[1], type: 'constant', line: lineNum });
      continue;
    }

    // export default
    const exportDefaultMatch = line.match(
      /export\s+default\s+(?:(?:async\s+)?function|class)?\s*(\w+)?/,
    );
    if (exportDefaultMatch) {
      exports.push({
        name: exportDefaultMatch[1] ?? 'default',
        type: 'default',
        line: lineNum,
      });
      continue;
    }

    // export { foo, bar }  (local re-export, no "from")
    const exportListMatch = line.match(/export\s+{([^}]+)}/);
    if (exportListMatch && !reExportMatch) {
      const specs = exportListMatch[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/).pop()!.trim())
        .filter(Boolean);
      for (const spec of specs) {
        exports.push({ name: spec, type: 'unknown', line: lineNum });
      }
    }
  }

  return { filePath, language: 'typescript', imports, exports };
}

function extractSpecifiers(
  group1: string | undefined,
  group2: string | undefined,
): string[] {
  const specifiers: string[] = [];

  for (const group of [group1, group2]) {
    if (!group) continue;

    if (group.startsWith('{')) {
      // Named: { foo, bar as baz }
      const inner = group.slice(1, -1);
      const specs = inner
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      specifiers.push(...specs);
    } else if (group.startsWith('*')) {
      // Namespace: * as foo
      const name = group.match(/\*\s+as\s+(\w+)/)?.[1];
      if (name) specifiers.push(name);
    } else {
      // Default import
      specifiers.push(group);
    }
  }

  return specifiers;
}
