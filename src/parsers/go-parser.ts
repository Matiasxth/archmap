import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';

/**
 * Regex-based Go parser.
 * Go conventions: exported symbols start with uppercase.
 * Imports use quoted paths. Packages are directory-based.
 */
export function parseGo(content: string, filePath: string): ParseResult {
  const lines = content.split('\n');
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Import block: import ( ... )
    if (trimmed === 'import (') {
      inImportBlock = true;
      continue;
    }

    if (inImportBlock) {
      if (trimmed === ')') {
        inImportBlock = false;
        continue;
      }

      // Line inside import block: "package/path" or alias "package/path"
      const blockImport = trimmed.match(/^(?:(\w+)\s+)?"([^"]+)"/);
      if (blockImport) {
        const alias = blockImport[1] ?? '';
        const source = blockImport[2];
        imports.push({
          source,
          specifiers: alias ? [alias] : [source.split('/').pop()!],
          isRelative: isRelativeGoImport(source, filePath),
          isDynamic: false,
          line: lineNum,
        });
      }
      continue;
    }

    // Single-line import: import "package/path" or import alias "package/path"
    const singleImport = trimmed.match(/^import\s+(?:(\w+)\s+)?"([^"]+)"/);
    if (singleImport) {
      const alias = singleImport[1] ?? '';
      const source = singleImport[2];
      imports.push({
        source,
        specifiers: alias ? [alias] : [source.split('/').pop()!],
        isRelative: isRelativeGoImport(source, filePath),
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // Exported function: func FunctionName(
    const funcMatch = trimmed.match(/^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)\s*\(/);
    if (funcMatch) {
      exports.push({ name: funcMatch[1], type: 'function', line: lineNum });
      continue;
    }

    // Exported type: type TypeName struct/interface/...
    const typeMatch = trimmed.match(/^type\s+([A-Z]\w*)\s+/);
    if (typeMatch) {
      const kind = trimmed.includes('interface') ? 'interface' : trimmed.includes('struct') ? 'class' : 'type';
      exports.push({ name: typeMatch[1], type: kind, line: lineNum });
      continue;
    }

    // Exported const/var: const/var Name = ...
    const constMatch = trimmed.match(/^(?:const|var)\s+([A-Z]\w*)\s/);
    if (constMatch) {
      exports.push({ name: constMatch[1], type: 'constant', line: lineNum });
      continue;
    }

    // Exported const block: const ( Name = ... )
    if (trimmed === 'const (' || trimmed === 'var (') {
      // Scan ahead for exported names
      for (let j = i + 1; j < lines.length; j++) {
        const blockLine = lines[j].trim();
        if (blockLine === ')') break;
        const blockConst = blockLine.match(/^([A-Z]\w*)\s/);
        if (blockConst) {
          exports.push({ name: blockConst[1], type: 'constant', line: j + 1 });
        }
      }
    }
  }

  return { filePath, language: 'go', imports, exports };
}

/**
 * Determine if a Go import is project-internal (relative).
 * Go uses module paths like "github.com/user/repo/pkg/auth".
 * Standard library imports don't contain dots in the first segment.
 */
function isRelativeGoImport(source: string, filePath: string): boolean {
  const firstSegment = source.split('/')[0];
  // Standard library: no dots (e.g., "fmt", "net/http", "encoding/json")
  if (!firstSegment.includes('.')) return false;
  // External or internal module: has dots (e.g., "github.com/...")
  // We treat all dotted imports as potentially internal for now
  return true;
}
