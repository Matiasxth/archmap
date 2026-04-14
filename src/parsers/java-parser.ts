import type { ParseResult, ImportInfo, ExportInfo } from '../types.js';

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

  return { filePath, language: 'java', imports, exports };
}

/**
 * Java import is "relative" (same project) if it shares the same root package.
 */
function isRelativeJavaImport(importPkg: string, currentPkg: string): boolean {
  if (!currentPkg) return false;
  const rootPkg = currentPkg.split('.').slice(0, 2).join('.');
  return importPkg.startsWith(rootPkg);
}
