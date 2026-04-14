import { dirname, join, basename } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { DiscoveredFile } from '../scanner/file-discovery.js';

/**
 * Universal project file index.
 *
 * Maps import paths to actual file paths for languages where
 * absolute internal imports exist (Python, Java, Go, TypeScript).
 *
 * Usage:
 *   const index = buildProjectIndex(files, root);
 *   const resolved = index.resolve("app.models.luminaire", "python");
 *   // → "backend/app/models/luminaire.py"
 */
export interface ProjectIndex {
  resolve(importSource: string, language: string, fromFile?: string): string | null;
}

export function buildProjectIndex(files: DiscoveredFile[], root: string): ProjectIndex {
  const fileSet = new Set(files.map((f) => f.relativePath));
  const allPaths = files.map((f) => f.relativePath);

  const pythonIndex = buildPythonIndex(allPaths.filter((f) => f.endsWith('.py')));
  const javaIndex = buildJavaIndex(allPaths.filter((f) => f.endsWith('.java')));
  const goModulePath = detectGoModule(root);
  const tsAliases = loadTsAliases(root);

  return {
    resolve(importSource: string, language: string, fromFile?: string): string | null {
      switch (language) {
        case 'python':
          return resolvePython(importSource, pythonIndex, fileSet);
        case 'java':
          return resolveJava(importSource, javaIndex, fileSet);
        case 'go':
          return resolveGo(importSource, goModulePath, fileSet);
        case 'typescript':
        case 'javascript':
          return resolveTypeScript(importSource, tsAliases, fileSet);
        default:
          return null;
      }
    },
  };
}

// ============================================================
// PYTHON
// ============================================================

interface PythonPackageRoot {
  packageName: string;  // "app"
  fsPath: string;       // "backend/app"
}

function buildPythonIndex(pyFiles: string[]): PythonPackageRoot[] {
  const roots: PythonPackageRoot[] = [];
  const initFiles = pyFiles.filter((f) => basename(f) === '__init__.py');

  // Find package roots: directories with __init__.py whose parent does NOT have __init__.py
  const packageDirs = new Set(initFiles.map((f) => dirname(f)));

  for (const dir of packageDirs) {
    const parent = dirname(dir);
    if (parent === '.' || !packageDirs.has(parent)) {
      // This is a root package
      roots.push({
        packageName: basename(dir),
        fsPath: dir,
      });
    }
  }

  // Also detect implicit namespace packages: directories with .py files but no __init__.py
  const dirsWithPy = new Set<string>();
  for (const f of pyFiles) {
    if (basename(f) !== '__init__.py') {
      dirsWithPy.add(dirname(f));
    }
  }

  for (const dir of dirsWithPy) {
    if (packageDirs.has(dir)) continue; // Already a real package
    const parent = dirname(dir);
    const name = basename(dir);
    // Only add if parent is already a package root
    const isChild = roots.some((r) => dir.startsWith(r.fsPath));
    if (!isChild && !roots.some((r) => r.packageName === name)) {
      roots.push({ packageName: name, fsPath: dir });
    }
  }

  return roots;
}

function resolvePython(importSource: string, roots: PythonPackageRoot[], fileSet: Set<string>): string | null {
  const parts = importSource.split('.');
  const firstPart = parts[0];

  // Find matching root
  const root = roots.find((r) => r.packageName === firstPart);
  if (!root) return null;

  // Build file path: replace package name with fs path, rest with /
  const restParts = parts.slice(1);
  const basePath = restParts.length > 0
    ? join(root.fsPath, ...restParts).replace(/\\/g, '/')
    : root.fsPath;

  // Try as file.py
  const asFile = basePath + '.py';
  if (fileSet.has(asFile)) return asFile;

  // Try as package/__init__.py
  const asPackage = join(basePath, '__init__.py').replace(/\\/g, '/');
  if (fileSet.has(asPackage)) return asPackage;

  // Try without the last part (it might be a symbol, not a module)
  if (parts.length > 2) {
    const parentParts = parts.slice(1, -1);
    const parentPath = join(root.fsPath, ...parentParts).replace(/\\/g, '/');
    const parentFile = parentPath + '.py';
    if (fileSet.has(parentFile)) return parentFile;
    const parentInit = join(parentPath, '__init__.py').replace(/\\/g, '/');
    if (fileSet.has(parentInit)) return parentInit;
  }

  return null;
}

// ============================================================
// JAVA
// ============================================================

interface JavaRoot {
  basePackage: string;  // "com.example"
  fsPath: string;       // "src/main/java/com/example"
}

function buildJavaIndex(javaFiles: string[]): JavaRoot[] {
  const roots: JavaRoot[] = [];

  for (const file of javaFiles) {
    // Read package declaration from first lines
    try {
      // We can't read the file here (async), so detect from path structure
      // Java convention: src/main/java/com/example/service/UserService.java
      // or: src/com/example/service/UserService.java
      const parts = file.replace(/\\/g, '/').split('/');
      const javaIdx = parts.indexOf('java');
      if (javaIdx >= 0 && parts.length > javaIdx + 2) {
        const packageParts = parts.slice(javaIdx + 1, -1); // everything between java/ and filename
        const basePackage = packageParts.slice(0, 2).join('.'); // first 2 levels: com.example
        const fsPath = parts.slice(0, javaIdx + 1 + 2).join('/');

        if (!roots.some((r) => r.basePackage === basePackage)) {
          roots.push({ basePackage, fsPath });
        }
      }
    } catch { /* skip */ }
  }

  return roots;
}

function resolveJava(importSource: string, roots: JavaRoot[], fileSet: Set<string>): string | null {
  // importSource: "com.example.service.UserService"
  // Need to map to: "src/main/java/com/example/service/UserService.java"

  for (const root of roots) {
    if (!importSource.startsWith(root.basePackage)) continue;

    const restPath = importSource.replace(root.basePackage, '').replace(/^\./, '').replace(/\./g, '/');
    const fullPath = restPath
      ? `${root.fsPath}/${restPath}.java`
      : root.fsPath;

    if (fileSet.has(fullPath.replace(/\\/g, '/'))) return fullPath.replace(/\\/g, '/');
  }

  // Fallback: try direct path mapping for any java file
  const asPath = importSource.replace(/\./g, '/');
  for (const file of fileSet) {
    if (file.endsWith('.java') && file.replace(/\\/g, '/').includes(asPath)) {
      return file;
    }
  }

  return null;
}

// ============================================================
// GO
// ============================================================

function detectGoModule(root: string): string {
  const goModPath = join(root, 'go.mod');
  if (!existsSync(goModPath)) return '';

  try {
    const content = readFileSync(goModPath, 'utf-8');
    const match = content.match(/^module\s+(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function resolveGo(importSource: string, modulePath: string, fileSet: Set<string>): string | null {
  if (!modulePath) return null;

  // importSource: "github.com/user/repo/pkg/auth"
  // modulePath:   "github.com/user/repo"
  // Strip module prefix → "pkg/auth"
  if (!importSource.startsWith(modulePath)) return null;

  const localPath = importSource.slice(modulePath.length).replace(/^\//, '');
  if (!localPath) return null;

  // Try to find any .go file in that directory
  for (const file of fileSet) {
    if (file.endsWith('.go') && dirname(file).replace(/\\/g, '/') === localPath) {
      return file;
    }
  }

  // Try as a direct file
  for (const file of fileSet) {
    if (file.endsWith('.go') && file.replace(/\\/g, '/').startsWith(localPath + '/')) {
      return file;
    }
  }

  return null;
}

// ============================================================
// TYPESCRIPT / JAVASCRIPT
// ============================================================

interface TsAlias {
  prefix: string;  // "@/"
  target: string;  // "src/"
}

function loadTsAliases(root: string): TsAlias[] {
  const aliases: TsAlias[] = [];

  for (const configFile of ['tsconfig.json', 'jsconfig.json']) {
    const configPath = join(root, configFile);
    if (!existsSync(configPath)) continue;

    try {
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      const paths = config.compilerOptions?.paths;
      if (!paths) continue;

      const baseUrl = config.compilerOptions?.baseUrl ?? '.';

      for (const [alias, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        const target = (targets[0] as string).replace('*', '');
        const prefix = alias.replace('*', '');
        aliases.push({
          prefix,
          target: join(baseUrl, target).replace(/\\/g, '/'),
        });
      }
    } catch { /* skip */ }
  }

  return aliases;
}

function resolveTypeScript(importSource: string, aliases: TsAlias[], fileSet: Set<string>): string | null {
  for (const alias of aliases) {
    if (!importSource.startsWith(alias.prefix)) continue;

    const rest = importSource.slice(alias.prefix.length);
    const basePath = (alias.target + rest).replace(/\\/g, '/');

    // Try extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
    for (const ext of extensions) {
      if (fileSet.has(basePath + ext)) return basePath + ext;
    }

    // Try index
    for (const ext of extensions) {
      const indexPath = basePath + '/index' + ext;
      if (fileSet.has(indexPath)) return indexPath;
    }

    // Try stripping .js extension (TS uses .js in imports)
    const stripped = basePath.replace(/\.js$/, '');
    for (const ext of extensions) {
      if (fileSet.has(stripped + ext)) return stripped + ext;
    }
  }

  return null;
}
