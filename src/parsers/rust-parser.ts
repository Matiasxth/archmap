import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';

/**
 * Regex-based Rust parser.
 * Rust conventions: pub items are exported, mod/use for imports.
 * Handles: use statements, mod declarations, pub fn/struct/enum/trait/type/const.
 */
export function parseRust(content: string, filePath: string): ParseResult {
  const lines = content.split('\n');
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  let inUseBlock = false;
  let useBlockBase = '';
  let useBlockLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Multi-line use block: use crate::module::{
    if (inUseBlock) {
      if (trimmed.includes('}')) {
        const beforeBrace = trimmed.replace(/}.*/, '').trim();
        if (beforeBrace) {
          const specs = beforeBrace.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
          for (const spec of specs) {
            imports.push({
              source: `${useBlockBase}::${spec}`,
              specifiers: [spec.split('::').pop()!],
              isRelative: isRelativeRustImport(useBlockBase),
              isDynamic: false,
              line: useBlockLine,
            });
          }
        }
        inUseBlock = false;
        continue;
      }
      // Middle of use block
      const specs = trimmed.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const spec of specs) {
        imports.push({
          source: `${useBlockBase}::${spec}`,
          specifiers: [spec.split('::').pop()!],
          isRelative: isRelativeRustImport(useBlockBase),
          isDynamic: false,
          line: lineNum,
        });
      }
      continue;
    }

    // use crate::module::{Item1, Item2};
    const useBlockMatch = trimmed.match(/^(?:pub\s+)?use\s+([\w:]+)::\{(.*)$/);
    if (useBlockMatch) {
      useBlockBase = useBlockMatch[1];
      useBlockLine = lineNum;
      const rest = useBlockMatch[2];

      if (rest.includes('}')) {
        // Single-line block: use foo::{A, B};
        const inner = rest.replace(/}.*/, '').trim();
        const specs = inner.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        for (const spec of specs) {
          imports.push({
            source: `${useBlockBase}::${spec}`,
            specifiers: [spec.split('::').pop()!],
            isRelative: isRelativeRustImport(useBlockBase),
            isDynamic: false,
            line: lineNum,
          });
        }
      } else {
        inUseBlock = true;
        const specs = rest.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        for (const spec of specs) {
          imports.push({
            source: `${useBlockBase}::${spec}`,
            specifiers: [spec.split('::').pop()!],
            isRelative: isRelativeRustImport(useBlockBase),
            isDynamic: false,
            line: lineNum,
          });
        }
      }
      continue;
    }

    // Simple use: use std::collections::HashMap;
    // use crate::auth::verify;
    const useMatch = trimmed.match(/^(?:pub\s+)?use\s+([\w:]+(?:::\*)?)\s*(?:as\s+(\w+))?;/);
    if (useMatch) {
      const source = useMatch[1];
      const alias = useMatch[2];
      const lastPart = source.split('::').pop()!;
      imports.push({
        source,
        specifiers: [alias ?? lastPart],
        isRelative: isRelativeRustImport(source),
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // mod declaration: mod auth; (imports a module file)
    const modMatch = trimmed.match(/^(?:pub\s+)?mod\s+(\w+)\s*;/);
    if (modMatch) {
      imports.push({
        source: modMatch[1],
        specifiers: [modMatch[1]],
        isRelative: true,
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // Exports: pub fn
    const pubFnMatch = trimmed.match(/^pub(?:\([\w:]+\))?\s+(?:async\s+)?fn\s+(\w+)/);
    if (pubFnMatch) {
      exports.push({ name: pubFnMatch[1], type: 'function', line: lineNum });
      continue;
    }

    // Exports: pub struct
    const pubStructMatch = trimmed.match(/^pub(?:\([\w:]+\))?\s+struct\s+(\w+)/);
    if (pubStructMatch) {
      exports.push({ name: pubStructMatch[1], type: 'class', line: lineNum });
      continue;
    }

    // Exports: pub enum
    const pubEnumMatch = trimmed.match(/^pub(?:\([\w:]+\))?\s+enum\s+(\w+)/);
    if (pubEnumMatch) {
      exports.push({ name: pubEnumMatch[1], type: 'type', line: lineNum });
      continue;
    }

    // Exports: pub trait
    const pubTraitMatch = trimmed.match(/^pub(?:\([\w:]+\))?\s+trait\s+(\w+)/);
    if (pubTraitMatch) {
      exports.push({ name: pubTraitMatch[1], type: 'interface', line: lineNum });
      continue;
    }

    // Exports: pub type
    const pubTypeMatch = trimmed.match(/^pub(?:\([\w:]+\))?\s+type\s+(\w+)/);
    if (pubTypeMatch) {
      exports.push({ name: pubTypeMatch[1], type: 'type', line: lineNum });
      continue;
    }

    // Exports: pub const / pub static
    const pubConstMatch = trimmed.match(/^pub(?:\([\w:]+\))?\s+(?:const|static)\s+(\w+)/);
    if (pubConstMatch) {
      exports.push({ name: pubConstMatch[1], type: 'constant', line: lineNum });
      continue;
    }
  }

  return { filePath, language: 'rust', imports, exports };
}

/**
 * Rust relative imports start with crate::, self::, or super::
 */
function isRelativeRustImport(source: string): boolean {
  return source.startsWith('crate') || source.startsWith('self') || source.startsWith('super');
}
