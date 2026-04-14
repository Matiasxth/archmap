import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';
import { parseToTree, getLanguageObj } from './tree-sitter-pool.js';

/**
 * TypeScript/JavaScript parser using tree-sitter AST.
 * Falls back to regex if tree-sitter is unavailable.
 */
export async function parseTypeScriptAST(content: string, filePath: string): Promise<ParseResult> {
  const lang = filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript';
  const tree = await parseToTree(content, lang);

  if (!tree) {
    return parseTypeScriptRegex(content, filePath);
  }

  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  walkNode(tree.rootNode, imports, exports);

  return { filePath, language: 'typescript', parseMethod: 'ast' as const, imports, exports };
}

function walkNode(node: any, imports: ImportInfo[], exports: ExportInfo[]) {
  switch (node.type) {
    case 'import_statement':
      parseImportStatement(node, imports);
      break;

    case 'export_statement':
      parseExportStatement(node, imports, exports);
      break;

    case 'lexical_declaration':
    case 'variable_declaration':
      // Check for require() calls: const x = require('y')
      parseRequireDeclaration(node, imports);
      break;

    case 'call_expression':
      // Dynamic import: import('module')
      parseDynamicImport(node, imports);
      break;
  }

  // Recurse into children
  for (let i = 0; i < node.childCount; i++) {
    walkNode(node.child(i), imports, exports);
  }
}

function parseImportStatement(node: any, imports: ImportInfo[]) {
  const sourceNode = node.children.find((c: any) => c.type === 'string' || c.type === 'template_string');
  if (!sourceNode) return;

  const source = stripQuotes(sourceNode.text);
  const specifiers: string[] = [];

  const importClause = node.children.find((c: any) => c.type === 'import_clause');
  if (importClause) {
    for (let i = 0; i < importClause.childCount; i++) {
      const child = importClause.child(i);
      if (child.type === 'identifier') {
        // Default import
        specifiers.push(child.text);
      } else if (child.type === 'named_imports') {
        // { foo, bar }
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j);
          if (spec.type === 'import_specifier') {
            const name = spec.children.find((c: any) => c.type === 'identifier');
            if (name) specifiers.push(name.text);
          }
        }
      } else if (child.type === 'namespace_import') {
        // * as foo
        const name = child.children.find((c: any) => c.type === 'identifier');
        if (name) specifiers.push(name.text);
      }
    }
  }

  imports.push({
    source,
    specifiers,
    isRelative: source.startsWith('.') || source.startsWith('/'),
    isDynamic: false,
    line: node.startPosition.row + 1,
  });
}

function parseExportStatement(node: any, imports: ImportInfo[], exports: ExportInfo[]) {
  const line = node.startPosition.row + 1;

  // export { foo } from 'module' (re-export)
  const sourceNode = node.children.find((c: any) => c.type === 'string');
  if (sourceNode) {
    const source = stripQuotes(sourceNode.text);
    const specifiers: string[] = [];

    const exportClause = node.children.find((c: any) => c.type === 'export_clause');
    if (exportClause) {
      for (let i = 0; i < exportClause.childCount; i++) {
        const spec = exportClause.child(i);
        if (spec.type === 'export_specifier') {
          const name = spec.children.find((c: any) => c.type === 'identifier');
          if (name) {
            specifiers.push(name.text);
            exports.push({ name: name.text, type: 'unknown', line });
          }
        }
      }
    }

    // export * from 'module'
    const star = node.children.find((c: any) => c.text === '*');
    if (star) specifiers.push('*');

    imports.push({
      source,
      specifiers,
      isRelative: source.startsWith('.') || source.startsWith('/'),
      isDynamic: false,
      line,
    });
    return;
  }

  // export function/class/const/etc
  const declaration = node.children.find((c: any) =>
    ['function_declaration', 'generator_function_declaration', 'class_declaration',
     'lexical_declaration', 'variable_declaration', 'type_alias_declaration',
     'interface_declaration', 'enum_declaration', 'abstract_class_declaration'].includes(c.type),
  );

  if (declaration) {
    const nameNode = declaration.children.find((c: any) => c.type === 'identifier' || c.type === 'type_identifier');
    if (nameNode) {
      const type = inferExportType(declaration.type);
      exports.push({ name: nameNode.text, type, line });
    }

    // lexical_declaration can have multiple declarators: export const a = 1, b = 2
    if (declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration') {
      for (let i = 0; i < declaration.childCount; i++) {
        const child = declaration.child(i);
        if (child.type === 'variable_declarator') {
          const name = child.children.find((c: any) => c.type === 'identifier');
          if (name) exports.push({ name: name.text, type: 'constant', line });
        }
      }
    }
    return;
  }

  // export default
  const defaultKw = node.children.find((c: any) => c.text === 'default');
  if (defaultKw) {
    const nameNode = node.children.find((c: any) => c.type === 'identifier');
    exports.push({ name: nameNode?.text ?? 'default', type: 'default', line });
    return;
  }

  // export { foo, bar }
  const exportClause = node.children.find((c: any) => c.type === 'export_clause');
  if (exportClause) {
    for (let i = 0; i < exportClause.childCount; i++) {
      const spec = exportClause.child(i);
      if (spec.type === 'export_specifier') {
        // Get the 'as' name if present, otherwise the original name
        const children = spec.children.filter((c: any) => c.type === 'identifier');
        const exportedName = children.length > 1 ? children[1].text : children[0]?.text;
        if (exportedName) exports.push({ name: exportedName, type: 'unknown', line });
      }
    }
  }
}

function parseRequireDeclaration(node: any, imports: ImportInfo[]) {
  const text = node.text;
  if (!text.includes('require(')) return;

  const match = text.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  if (!match) return;

  const source = match[1];
  const specifiers: string[] = [];

  // Extract variable name
  const varMatch = text.match(/(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=/);
  if (varMatch) {
    if (varMatch[1]) {
      specifiers.push(...varMatch[1].split(',').map((s: string) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
    } else if (varMatch[2]) {
      specifiers.push(varMatch[2]);
    }
  }

  imports.push({
    source,
    specifiers,
    isRelative: source.startsWith('.') || source.startsWith('/'),
    isDynamic: false,
    line: node.startPosition.row + 1,
  });
}

function parseDynamicImport(node: any, imports: ImportInfo[]) {
  if (node.type !== 'call_expression') return;
  const callee = node.child(0);
  if (!callee || callee.type !== 'import') return;

  const args = node.children.find((c: any) => c.type === 'arguments');
  if (!args) return;

  const strArg = args.children.find((c: any) => c.type === 'string');
  if (!strArg) return;

  const source = stripQuotes(strArg.text);
  imports.push({
    source,
    specifiers: [],
    isRelative: source.startsWith('.') || source.startsWith('/'),
    isDynamic: true,
    line: node.startPosition.row + 1,
  });
}

function inferExportType(nodeType: string): ExportInfo['type'] {
  switch (nodeType) {
    case 'function_declaration':
    case 'generator_function_declaration':
      return 'function';
    case 'class_declaration':
    case 'abstract_class_declaration':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'type_alias_declaration':
      return 'type';
    case 'enum_declaration':
      return 'type';
    case 'lexical_declaration':
    case 'variable_declaration':
      return 'constant';
    default:
      return 'unknown';
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '');
}

// --- Regex fallback (original implementation) ---

export function parseTypeScriptRegex(content: string, filePath: string): ParseResult {
  const lines = content.split('\n');
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    const importMatch = line.match(
      /import\s+(?:type\s+)?(?:({[^}]+}|\*\s+as\s+\w+|\w+)(?:\s*,\s*({[^}]+}|\*\s+as\s+\w+))?\s+from\s+)?['"](.[^'"]*)['"]/,
    );
    if (importMatch) {
      const source = importMatch[3];
      const specifiers = extractSpecifiers(importMatch[1], importMatch[2]);
      imports.push({ source, specifiers, isRelative: source.startsWith('.') || source.startsWith('/'), isDynamic: false, line: lineNum });
      continue;
    }

    const requireMatch = line.match(/(?:const|let|var)\s+(?:{([^}]+)}|(\w+))\s*=\s*require\s*\(\s*['"](.[^'"]*)['"]\s*\)/);
    if (requireMatch) {
      const source = requireMatch[3];
      const specifiers = requireMatch[1] ? requireMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()) : requireMatch[2] ? [requireMatch[2]] : [];
      imports.push({ source, specifiers, isRelative: source.startsWith('.') || source.startsWith('/'), isDynamic: false, line: lineNum });
      continue;
    }

    const dynamicMatch = line.match(/import\s*\(\s*['"](.[^'"]*)['"]\s*\)/);
    if (dynamicMatch && !importMatch) {
      imports.push({ source: dynamicMatch[1], specifiers: [], isRelative: dynamicMatch[1].startsWith('.') || dynamicMatch[1].startsWith('/'), isDynamic: true, line: lineNum });
    }

    const reExportMatch = line.match(/export\s+(?:type\s+)?{([^}]+)}\s+from\s+['"](.[^'"]*)['"]/);
    if (reExportMatch) {
      const source = reExportMatch[2];
      const specifiers = reExportMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      imports.push({ source, specifiers, isRelative: source.startsWith('.') || source.startsWith('/'), isDynamic: false, line: lineNum });
      for (const spec of specifiers) exports.push({ name: spec, type: 'unknown', line: lineNum });
      continue;
    }

    const reExportAllMatch = line.match(/export\s+\*\s+(?:as\s+(\w+)\s+)?from\s+['"](.[^'"]*)['"]/);
    if (reExportAllMatch) {
      imports.push({ source: reExportAllMatch[2], specifiers: ['*'], isRelative: reExportAllMatch[2].startsWith('.') || reExportAllMatch[2].startsWith('/'), isDynamic: false, line: lineNum });
      continue;
    }

    const exportFnMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)/);
    if (exportFnMatch) { exports.push({ name: exportFnMatch[1], type: 'function', line: lineNum }); continue; }

    const exportClassMatch = line.match(/export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (exportClassMatch) { exports.push({ name: exportClassMatch[1], type: 'class', line: lineNum }); continue; }

    const exportInterfaceMatch = line.match(/export\s+interface\s+(\w+)/);
    if (exportInterfaceMatch) { exports.push({ name: exportInterfaceMatch[1], type: 'interface', line: lineNum }); continue; }

    const exportTypeMatch = line.match(/export\s+type\s+(\w+)/);
    if (exportTypeMatch) { exports.push({ name: exportTypeMatch[1], type: 'type', line: lineNum }); continue; }

    const exportConstMatch = line.match(/export\s+(?:const|let|var)\s+(\w+)/);
    if (exportConstMatch) { exports.push({ name: exportConstMatch[1], type: 'constant', line: lineNum }); continue; }

    const exportDefaultMatch = line.match(/export\s+default\s+(?:(?:async\s+)?function|class)?\s*(\w+)?/);
    if (exportDefaultMatch) { exports.push({ name: exportDefaultMatch[1] ?? 'default', type: 'default', line: lineNum }); continue; }

    const exportListMatch = line.match(/export\s+{([^}]+)}/);
    if (exportListMatch && !reExportMatch) {
      const specs = exportListMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
      for (const spec of specs) exports.push({ name: spec, type: 'unknown', line: lineNum });
    }
  }

  return { filePath, language: 'typescript', parseMethod: 'regex' as const, imports, exports };
}

function extractSpecifiers(group1: string | undefined, group2: string | undefined): string[] {
  const specifiers: string[] = [];
  for (const group of [group1, group2]) {
    if (!group) continue;
    if (group.startsWith('{')) {
      specifiers.push(...group.slice(1, -1).split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
    } else if (group.startsWith('*')) {
      const name = group.match(/\*\s+as\s+(\w+)/)?.[1];
      if (name) specifiers.push(name);
    } else {
      specifiers.push(group);
    }
  }
  return specifiers;
}

// Keep backward compatibility — sync function delegates to regex
export function parseTypeScript(content: string, filePath: string): ParseResult {
  return parseTypeScriptRegex(content, filePath);
}
