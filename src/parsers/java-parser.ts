import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';
import { parseToTree } from './tree-sitter-pool.js';

/**
 * AST-based Java parser using tree-sitter.
 */
export async function parseJavaAST(content: string, filePath: string): Promise<ParseResult> {
  const tree = await parseToTree(content, 'java');
  if (!tree) return parseJava(content, filePath);

  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  let currentPackage = '';

  for (let i = 0; i < tree.rootNode.childCount; i++) {
    const node = tree.rootNode.child(i);

    if (node.type === 'package_declaration') {
      const scopedId = node.children.find((c: any) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (scopedId) currentPackage = scopedId.text;
    }

    if (node.type === 'import_declaration') {
      const scopedId = node.children.find((c: any) =>
        c.type === 'scoped_identifier' || c.type === 'identifier' || c.type === 'asterisk',
      );
      if (scopedId) {
        const fullPath = scopedId.text;
        const isWildcard = node.children.some((c: any) => c.type === 'asterisk') || fullPath.endsWith('.*');
        const parts = fullPath.replace('.*', '').split('.');
        const lastPart = parts[parts.length - 1];
        const isClass = !isWildcard && /^[A-Z]/.test(lastPart);
        const packagePath = isClass ? parts.slice(0, -1).join('.') : fullPath.replace('.*', '');

        imports.push({
          source: packagePath,
          specifiers: isWildcard ? ['*'] : [lastPart],
          isRelative: isRelativeJavaImport(packagePath, currentPackage),
          isDynamic: false,
          line: node.startPosition.row + 1,
        });
      }
    }

    // Top-level declarations
    extractJavaDeclaration(node, exports);
  }

  return { filePath, language: 'java', parseMethod: 'ast' as const, imports, exports };
}

function extractJavaDeclaration(node: any, exports: ExportInfo[]) {
  const line = node.startPosition.row + 1;
  const modifiers = node.children?.filter((c: any) => c.type === 'modifiers');
  const isPublic = modifiers?.some((m: any) => m.text.includes('public')) ?? false;

  if (!isPublic && !['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'].includes(node.type)) {
    // Recurse into class body for public methods
    if (node.type === 'class_body' || node.type === 'interface_body') {
      for (let i = 0; i < node.childCount; i++) {
        extractJavaDeclaration(node.child(i), exports);
      }
    }
    // Also check inside class/interface declarations
    for (let i = 0; i < (node.childCount ?? 0); i++) {
      const child = node.child(i);
      if (child?.type === 'class_body' || child?.type === 'interface_body') {
        extractJavaDeclaration(child, exports);
      }
    }
    return;
  }

  if (node.type === 'class_declaration') {
    const name = node.children.find((c: any) => c.type === 'identifier');
    if (name && isPublic) exports.push({ name: name.text, type: 'class', line });
  } else if (node.type === 'interface_declaration') {
    const name = node.children.find((c: any) => c.type === 'identifier');
    if (name && isPublic) exports.push({ name: name.text, type: 'interface', line });
  } else if (node.type === 'enum_declaration') {
    const name = node.children.find((c: any) => c.type === 'identifier');
    if (name && isPublic) exports.push({ name: name.text, type: 'type', line });
  } else if (node.type === 'record_declaration') {
    const name = node.children.find((c: any) => c.type === 'identifier');
    if (name && isPublic) exports.push({ name: name.text, type: 'class', line });
  } else if (node.type === 'method_declaration' && isPublic) {
    const name = node.children.find((c: any) => c.type === 'identifier');
    if (name) exports.push({ name: name.text, type: 'function', line });
  } else if (node.type === 'field_declaration' && isPublic) {
    const declarator = node.children.find((c: any) => c.type === 'variable_declarator');
    const name = declarator?.children.find((c: any) => c.type === 'identifier');
    const isStatic = modifiers?.some((m: any) => m.text.includes('static'));
    const isFinal = modifiers?.some((m: any) => m.text.includes('final'));
    if (name && isStatic && isFinal) {
      exports.push({ name: name.text, type: 'constant', line });
    }
  }
}

/**
 * Regex-based Java parser.
 * Java conventions: public items are exported, package/import for dependencies.
 * Handles: import statements, static imports, public class/interface/enum/method/field.
 */
export function parseJava(content: string, filePath: string): ParseResult {
  const lines = content.split('\n');
  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  let currentPackage = '';
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Handle block comments
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed === '') continue;

    // Package declaration
    const pkgMatch = trimmed.match(/^package\s+([\w.]+)\s*;/);
    if (pkgMatch) {
      currentPackage = pkgMatch[1];
      continue;
    }

    // Import: import com.example.service.UserService;
    // Static import: import static com.example.Constants.MAX_SIZE;
    const importMatch = trimmed.match(/^import\s+(static\s+)?([\w.*]+)\s*;/);
    if (importMatch) {
      const isStatic = !!importMatch[1];
      const source = importMatch[2];
      const isWildcard = source.endsWith('.*');

      // Determine package vs class
      const parts = source.split('.');
      const lastPart = parts[parts.length - 1];
      const isClass = !isWildcard && /^[A-Z]/.test(lastPart);
      const packagePath = isClass ? parts.slice(0, -1).join('.') : source.replace('.*', '');

      imports.push({
        source: packagePath,
        specifiers: isWildcard ? ['*'] : [lastPart],
        isRelative: isRelativeJavaImport(packagePath, currentPackage),
        isDynamic: false,
        line: lineNum,
      });
      continue;
    }

    // Public class
    const classMatch = trimmed.match(/^public\s+(?:abstract\s+|final\s+)?class\s+(\w+)/);
    if (classMatch) {
      exports.push({ name: classMatch[1], type: 'class', line: lineNum });
      continue;
    }

    // Public interface
    const ifaceMatch = trimmed.match(/^public\s+interface\s+(\w+)/);
    if (ifaceMatch) {
      exports.push({ name: ifaceMatch[1], type: 'interface', line: lineNum });
      continue;
    }

    // Public enum
    const enumMatch = trimmed.match(/^public\s+enum\s+(\w+)/);
    if (enumMatch) {
      exports.push({ name: enumMatch[1], type: 'type', line: lineNum });
      continue;
    }

    // Public record (Java 16+)
    const recordMatch = trimmed.match(/^public\s+record\s+(\w+)/);
    if (recordMatch) {
      exports.push({ name: recordMatch[1], type: 'class', line: lineNum });
      continue;
    }

    // Public methods (indented, within a class)
    // Matches: public Type methodName(, public static Type methodName(
    // Handles generics: public List<User> findAll(
    const methodMatch = trimmed.match(
      /^public\s+(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:synchronized\s+)?(?:<[\w<>,\s?]+>\s+)?[\w<>,\s?[\]]+\s+(\w+)\s*\(/,
    );
    if (methodMatch && !trimmed.match(/^public\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s/)) {
      exports.push({ name: methodMatch[1], type: 'function', line: lineNum });
      continue;
    }

    // Public static final constants: public static final String NAME = "value";
    const constMatch = trimmed.match(
      /^public\s+static\s+final\s+\w+(?:<[^>]+>)?\s+(\w+)\s*=/,
    );
    if (constMatch) {
      exports.push({ name: constMatch[1], type: 'constant', line: lineNum });
      continue;
    }
  }

  return { filePath, language: 'java', parseMethod: 'regex' as const, imports, exports };
}

/**
 * Java import is "relative" (same project) if it shares the same root package.
 */
function isRelativeJavaImport(importPkg: string, currentPkg: string): boolean {
  if (!currentPkg) return false;
  const rootPkg = currentPkg.split('.').slice(0, 2).join('.');
  return importPkg.startsWith(rootPkg);
}
