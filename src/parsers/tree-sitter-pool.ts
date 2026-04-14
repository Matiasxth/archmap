import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

// web-tree-sitter types
type TreeSitterParser = any;
type TreeSitterLanguage = any;
type TreeSitterTree = any;

let Parser: any = null;
const languageCache = new Map<string, TreeSitterLanguage>();
const parserInstance: { value: TreeSitterParser | null } = { value: null };

const LANGUAGE_WASM_MAP: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
};

/**
 * Initialize web-tree-sitter (once) and return the Parser class.
 */
async function initTreeSitter(): Promise<any> {
  if (Parser) return Parser;

  const TreeSitter = await import('web-tree-sitter');
  const TSParser = TreeSitter.default ?? TreeSitter;
  await TSParser.init();
  Parser = TSParser;
  return Parser;
}

/**
 * Get or create a parser instance with the given language loaded.
 */
export async function getParser(language: string): Promise<TreeSitterParser> {
  const TSParser = await initTreeSitter();

  if (!parserInstance.value) {
    parserInstance.value = new TSParser();
  }

  const lang = await getLanguage(language);
  if (lang) {
    parserInstance.value.setLanguage(lang);
  }

  return parserInstance.value;
}

/**
 * Load a tree-sitter language WASM grammar (cached).
 */
async function getLanguage(language: string): Promise<TreeSitterLanguage | null> {
  if (languageCache.has(language)) {
    return languageCache.get(language)!;
  }

  const wasmFile = LANGUAGE_WASM_MAP[language];
  if (!wasmFile) return null;

  try {
    // Resolve WASM file from tree-sitter-wasms package
    const wasmPath = resolveWasmPath(wasmFile);
    const TSParser = await initTreeSitter();
    const lang = await TSParser.Language.load(wasmPath);
    languageCache.set(language, lang);
    return lang;
  } catch (err) {
    // Silently fall back — the regex parser will be used instead
    return null;
  }
}

/**
 * Parse source code into a tree-sitter AST.
 */
export async function parseToTree(content: string, language: string): Promise<TreeSitterTree | null> {
  try {
    const parser = await getParser(language);
    return parser.parse(content);
  } catch {
    return null;
  }
}

/**
 * Run a tree-sitter query on a tree and return matches.
 */
export function runQuery(
  tree: TreeSitterTree,
  language: TreeSitterLanguage,
  querySource: string,
): Array<{ pattern: number; captures: Array<{ name: string; node: any }> }> {
  try {
    const query = language.query(querySource);
    return query.matches(tree.rootNode);
  } catch {
    return [];
  }
}

/**
 * Get the Language object for a given language name (cached).
 */
export async function getLanguageObj(language: string): Promise<TreeSitterLanguage | null> {
  return getLanguage(language);
}

function resolveWasmPath(wasmFile: string): string {
  // Try require.resolve first
  try {
    const pkgJson = require.resolve('tree-sitter-wasms/package.json');
    return join(dirname(pkgJson), 'out', wasmFile);
  } catch {
    // Fallback: try relative to node_modules
    return join('node_modules', 'tree-sitter-wasms', 'out', wasmFile);
  }
}
