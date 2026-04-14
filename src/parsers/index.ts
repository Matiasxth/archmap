import { readFile } from 'fs/promises';
import { parseTypeScriptAST, parseTypeScript } from './typescript-parser.js';
import { parsePythonAST, parsePython } from './python-parser.js';
import { parseGoAST, parseGo } from './go-parser.js';
import { parseRustAST, parseRust } from './rust-parser.js';
import { parseJavaAST, parseJava } from './java-parser.js';
import type { ParseResult } from '../types.js';
import type { DiscoveredFile } from '../scanner/file-discovery.js';

// AST parsers (async, tree-sitter)
const AST_PARSERS: Record<string, (content: string, filePath: string) => Promise<ParseResult>> = {
  typescript: parseTypeScriptAST,
  javascript: parseTypeScriptAST,
  python: parsePythonAST,
  go: parseGoAST,
  rust: parseRustAST,
  java: parseJavaAST,
};

// Regex parsers (sync) — fallback
const REGEX_PARSERS: Record<string, (content: string, filePath: string) => ParseResult> = {
  typescript: parseTypeScript,
  javascript: parseTypeScript,
  python: parsePython,
  go: parseGo,
  rust: parseRust,
  java: parseJava,
};

export async function parseFile(file: DiscoveredFile): Promise<ParseResult | null> {
  try {
    const content = await readFile(file.absolutePath, 'utf-8');

    // Try AST parser first
    const astParser = AST_PARSERS[file.language];
    if (astParser) {
      try {
        const result = await astParser(content, file.relativePath);
        // AST parser returns parseMethod:'ast' if tree-sitter worked,
        // or parseMethod:'regex' if it internally fell back
        return result;
      } catch {
        // Fall through to regex
      }
    }

    // Explicit regex fallback
    const regexParser = REGEX_PARSERS[file.language];
    if (regexParser) {
      const result = regexParser(content, file.relativePath);
      result.parseMethod = 'regex';
      return result;
    }

    return null;
  } catch {
    return null;
  }
}

export async function parseFiles(files: DiscoveredFile[]): Promise<ParseResult[]> {
  const results: ParseResult[] = [];

  for (const file of files) {
    const result = await parseFile(file);
    if (result) results.push(result);
  }

  return results;
}
