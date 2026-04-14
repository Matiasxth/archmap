import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';
import { parseToTree } from './tree-sitter-pool.js';

/**
 * AST-based Go parser using tree-sitter.
 */
export async function parseGoAST(content: string, filePath: string): Promise<ParseResult> {
  const tree = await parseToTree(content, 'go');
  if (!tree) return parseGo(content, filePath);

  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < tree.rootNode.childCount; i++) {
    const node = tree.rootNode.child(i);

    if (node.type === 'import_declaration') {
      // Single or block import
      for (let j = 0; j < node.childCount; j++) {
        const child = node.child(j);
        if (child.type === 'import_spec_list') {
          for (let k = 0; k < child.childCount; k++) {
            const spec = child.child(k);
            if (spec.type === 'import_spec') {
              extractGoImport(spec, imports, filePath);
            }
          }
        } else if (child.type === 'import_spec') {
          extractGoImport(child, imports, filePath);
        } else if (child.type === 'interpreted_string_literal') {
          const source = stripGoQuotes(child.text);
          imports.push({
            source,
            specifiers: [source.split('/').pop()!],
            isRelative: isRelativeGoImport(source, filePath),
            isDynamic: false,
            line: child.startPosition.row + 1,
          });
        }
      }
    }

    if (node.type === 'function_declaration') {
      const nameNode = node.children.find((c: any) => c.type === 'identifier');
      if (nameNode && /^[A-Z]/.test(nameNode.text)) {
        exports.push({ name: nameNode.text, type: 'function', line: node.startPosition.row + 1 });
      }
    }

    if (node.type === 'method_declaration') {
      const nameNode = node.children.find((c: any) => c.type === 'field_identifier');
      if (nameNode && /^[A-Z]/.test(nameNode.text)) {
        exports.push({ name: nameNode.text, type: 'function', line: node.startPosition.row + 1 });
      }
    }

    if (node.type === 'type_declaration') {
      for (let j = 0; j < node.childCount; j++) {
        const spec = node.child(j);
        if (spec.type === 'type_spec') {
          const nameNode = spec.children.find((c: any) => c.type === 'type_identifier');
          if (nameNode && /^[A-Z]/.test(nameNode.text)) {
            const hasInterface = spec.children.some((c: any) => c.type === 'interface_type');
            const hasStruct = spec.children.some((c: any) => c.type === 'struct_type');
            const type = hasInterface ? 'interface' : hasStruct ? 'class' : 'type';
            exports.push({ name: nameNode.text, type, line: spec.startPosition.row + 1 });
          }
        }
      }
    }

    if (node.type === 'const_declaration' || node.type === 'var_declaration') {
      for (let j = 0; j < node.childCount; j++) {
        const child = node.child(j);
        const specs = child.type === 'const_spec' || child.type === 'var_spec' ? [child] : [];
        if (child.type === 'const_spec_list' || child.type === 'var_spec_list') {
          for (let k = 0; k < child.childCount; k++) {
            if (child.child(k).type === 'const_spec' || child.child(k).type === 'var_spec') {
              specs.push(child.child(k));
            }
          }
        }
        for (const spec of specs) {
          const nameNode = spec.children.find((c: any) => c.type === 'identifier');
          if (nameNode && /^[A-Z]/.test(nameNode.text)) {
            exports.push({ name: nameNode.text, type: 'constant', line: spec.startPosition.row + 1 });
          }
        }
      }
    }
  }

  return { filePath, language: 'go', parseMethod: 'ast' as const, imports, exports };
}

function extractGoImport(spec: any, imports: ImportInfo[], filePath: string) {
  const strNode = spec.children.find((c: any) => c.type === 'interpreted_string_literal');
  if (!strNode) return;

  const source = stripGoQuotes(strNode.text);
  const aliasNode = spec.children.find((c: any) => c.type === 'package_identifier' || c.type === 'identifier');
  const alias = aliasNode?.text;

  imports.push({
    source,
    specifiers: alias ? [alias] : [source.split('/').pop()!],
    isRelative: isRelativeGoImport(source, filePath),
    isDynamic: false,
    line: spec.startPosition.row + 1,
  });
}

function stripGoQuotes(s: string): string {
  return s.replace(/^"|"$/g, '');
}

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

  return { filePath, language: 'go', parseMethod: 'regex' as const, imports, exports };
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
