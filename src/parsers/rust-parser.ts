import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';
import { parseToTree } from './tree-sitter-pool.js';

/**
 * AST-based Rust parser using tree-sitter.
 */
export async function parseRustAST(content: string, filePath: string): Promise<ParseResult> {
  const tree = await parseToTree(content, 'rust');
  if (!tree) return parseRust(content, filePath);

  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  walkRustNode(tree.rootNode, imports, exports);

  return { filePath, language: 'rust', imports, exports };
}

function walkRustNode(node: any, imports: ImportInfo[], exports: ExportInfo[]) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);

    if (child.type === 'use_declaration') {
      extractRustUse(child, imports);
    } else if (child.type === 'mod_item') {
      // mod name; (external module)
      const nameNode = child.children.find((c: any) => c.type === 'identifier');
      const hasBraces = child.children.some((c: any) => c.type === 'declaration_list');
      if (nameNode && !hasBraces) {
        imports.push({
          source: nameNode.text,
          specifiers: [nameNode.text],
          isRelative: true,
          isDynamic: false,
          line: child.startPosition.row + 1,
        });
      }
    }

    // Exports: items with visibility_modifier (pub)
    const hasPub = child.children?.some((c: any) => c.type === 'visibility_modifier');
    if (hasPub) {
      const line = child.startPosition.row + 1;

      if (child.type === 'function_item') {
        const name = child.children.find((c: any) => c.type === 'identifier');
        if (name) exports.push({ name: name.text, type: 'function', line });
      } else if (child.type === 'struct_item') {
        const name = child.children.find((c: any) => c.type === 'type_identifier');
        if (name) exports.push({ name: name.text, type: 'class', line });
      } else if (child.type === 'enum_item') {
        const name = child.children.find((c: any) => c.type === 'type_identifier');
        if (name) exports.push({ name: name.text, type: 'type', line });
      } else if (child.type === 'trait_item') {
        const name = child.children.find((c: any) => c.type === 'type_identifier');
        if (name) exports.push({ name: name.text, type: 'interface', line });
      } else if (child.type === 'type_item') {
        const name = child.children.find((c: any) => c.type === 'type_identifier');
        if (name) exports.push({ name: name.text, type: 'type', line });
      } else if (child.type === 'const_item' || child.type === 'static_item') {
        const name = child.children.find((c: any) => c.type === 'identifier');
        if (name) exports.push({ name: name.text, type: 'constant', line });
      }
    }
  }
}

function extractRustUse(node: any, imports: ImportInfo[]) {
  // Collect the full use path text
  const text = node.text;
  const line = node.startPosition.row + 1;

  // use path::to::item;
  const simpleMatch = text.match(/use\s+([\w:]+(?:::\*)?)\s*(?:as\s+(\w+))?;/);
  if (simpleMatch && !text.includes('{')) {
    const source = simpleMatch[1];
    const alias = simpleMatch[2];
    imports.push({
      source,
      specifiers: [alias ?? source.split('::').pop()!],
      isRelative: isRelativeRustImport(source),
      isDynamic: false,
      line,
    });
    return;
  }

  // use path::{A, B, C};
  const blockMatch = text.match(/use\s+([\w:]+)::\{([^}]+)\}/s);
  if (blockMatch) {
    const base = blockMatch[1];
    const items = blockMatch[2].split(',').map((s: string) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    for (const item of items) {
      imports.push({
        source: `${base}::${item}`,
        specifiers: [item.split('::').pop()!],
        isRelative: isRelativeRustImport(base),
        isDynamic: false,
        line,
      });
    }
  }
}

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
