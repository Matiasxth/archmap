import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';

/**
 * Regex-based Python parser.
 * Extracts imports and exports (module-level definitions).
 * Handles: import x, from x import y, relative imports,
 * __all__, class/function/variable definitions.
 */
export function parsePython(content: string, filePath: string): ParseResult {
  const lines = content.split('\n');
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  let inMultilineImport = false;
  let multilineSource = '';
  let multilineSpecifiers: string[] = [];
  let multilineLine = 0;

  // Check for __all__ to determine explicit public API
  const allMatch = content.match(/__all__\s*=\s*\[([^\]]*)\]/s);
  const explicitAll = allMatch
    ? allMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean)
    : null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Handle multiline imports: from x import (\n  a,\n  b\n)
    if (inMultilineImport) {
      if (trimmed.includes(')')) {
        // End of multiline import
        const beforeParen = trimmed.replace(')', '').trim();
        if (beforeParen) {
          multilineSpecifiers.push(
            ...beforeParen.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
          );
        }
        imports.push({
          source: multilineSource,
          specifiers: multilineSpecifiers,
          isRelative: multilineSource.startsWith('.'),
          isDynamic: false,
          line: multilineLine,
        });
        inMultilineImport = false;
        continue;
      }
      // Middle of multiline import
      multilineSpecifiers.push(
        ...trimmed.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
      );
      continue;
    }

    // from x import (... — start multiline
    const fromMultilineMatch = trimmed.match(
      /^from\s+([\w.]+)\s+import\s+\(\s*(.*)$/,
    );
    if (fromMultilineMatch) {
      inMultilineImport = true;
      multilineSource = fromMultilineMatch[1];
      multilineLine = lineNum;
      multilineSpecifiers = [];
      const rest = fromMultilineMatch[2].replace(')', '').trim();
      if (rest) {
        multilineSpecifiers.push(
          ...rest.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
        );
      }
      // Check if it closes on the same line
      if (fromMultilineMatch[2].includes(')')) {
        imports.push({
          source: multilineSource,
          specifiers: multilineSpecifiers,
          isRelative: multilineSource.startsWith('.'),
          isDynamic: false,
          line: lineNum,
        });
        inMultilineImport = false;
      }
      continue;
    }

    // from x import y, z
    const fromImportMatch = trimmed.match(
      /^from\s+([\w.]+)\s+import\s+(.+)$/,
    );
    if (fromImportMatch) {
      const source = fromImportMatch[1];
      const specsPart = fromImportMatch[2].split('#')[0]; // strip inline comment
      const specifiers = specsPart
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);

      imports.push({
        source,
        specifiers,
        isRelative: source.startsWith('.'),
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // import x, y
    // import x as y
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      const specsPart = importMatch[1].split('#')[0];
      const modules = specsPart.split(',').map((s) => s.trim());

      for (const mod of modules) {
        const asMatch = mod.match(/^([\w.]+)(?:\s+as\s+(\w+))?$/);
        if (asMatch) {
          imports.push({
            source: asMatch[1],
            specifiers: [asMatch[2] ?? asMatch[1].split('.').pop()!],
            isRelative: false,
            isDynamic: false,
            line: lineNum,
          });
        }
      }
      continue;
    }

    // Exports: class definitions
    const classMatch = trimmed.match(/^class\s+(\w+)/);
    if (classMatch && !trimmed.startsWith('_')) {
      exports.push({ name: classMatch[1], type: 'class', line: lineNum });
      continue;
    }

    // Exports: function definitions
    const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)/);
    if (funcMatch && !funcMatch[1].startsWith('_')) {
      exports.push({ name: funcMatch[1], type: 'function', line: lineNum });
      continue;
    }

    // Exports: top-level constants (UPPER_CASE = ...)
    const constMatch = trimmed.match(/^([A-Z][A-Z_0-9]+)\s*=/);
    if (constMatch) {
      exports.push({ name: constMatch[1], type: 'constant', line: lineNum });
      continue;
    }

    // Exports: top-level variable assignments (non-indented, non-private)
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      const varMatch = trimmed.match(/^([a-z]\w+)\s*(?::\s*\w+)?\s*=/);
      if (varMatch && !varMatch[1].startsWith('_')) {
        exports.push({ name: varMatch[1], type: 'constant', line: lineNum });
      }
    }
  }

  // If __all__ is defined, filter exports to only those listed
  const finalExports = explicitAll
    ? exports.filter((e) => explicitAll.includes(e.name))
    : exports;

  return { filePath, language: 'python', imports, exports: finalExports };
}
