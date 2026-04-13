import { readFile } from 'fs/promises';
import { parseTypeScript } from './typescript-parser.js';
import type { ParseResult } from '../types.js';
import type { DiscoveredFile } from '../scanner/file-discovery.js';

const PARSERS: Record<string, (content: string, filePath: string) => ParseResult> = {
  typescript: parseTypeScript,
  javascript: parseTypeScript, // JS uses same parser
};

export async function parseFile(file: DiscoveredFile): Promise<ParseResult | null> {
  const parser = PARSERS[file.language];
  if (!parser) return null;

  try {
    const content = await readFile(file.absolutePath, 'utf-8');
    return parser(content, file.relativePath);
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
