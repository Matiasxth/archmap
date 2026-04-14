import fg from 'fast-glob';
import ignore from 'ignore';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ArchmapConfig } from '../types.js';

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  java: ['.java'],
};

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  language: string;
  extension: string;
  isSupport: boolean;
}

const SUPPORT_PATTERNS = [
  /(^|\/)tests?\//i,
  /(^|\/)__tests__\//i,
  /(^|\/)spec\//i,
  /(^|\/)e2e\//i,
  /(^|\/)docs?\//i,
  /(^|\/)docs_src\//i,
  /(^|\/)documentation\//i,
  /(^|\/)examples?\//i,
  /(^|\/)samples?\//i,
  /(^|\/)benchmarks?\//i,
  /(^|\/)bench\//i,
  /(^|\/)fixtures?\//i,
  /(^|\/)__fixtures__\//i,
  /(^|\/)stories\//i,
  /(^|\/)__stories__\//i,
  /(^|\/)scripts?\//i,
];

export async function discoverFiles(
  root: string,
  config: ArchmapConfig,
): Promise<DiscoveredFile[]> {
  // Build glob patterns from configured languages
  const extensions = config.languages.flatMap(
    (lang) => LANGUAGE_EXTENSIONS[lang] ?? [],
  );

  if (extensions.length === 0) return [];

  const pattern =
    extensions.length === 1
      ? `**/*${extensions[0]}`
      : `**/*{${extensions.join(',')}}`;

  // Load .gitignore
  const ig = ignore();
  const gitignorePath = join(root, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignoreContent = await readFile(gitignorePath, 'utf-8');
    ig.add(gitignoreContent);
  }

  // Always exclude these
  ig.add(config.exclude);

  const files = await fg(pattern, {
    cwd: root,
    dot: false,
    absolute: false,
    onlyFiles: true,
    ignore: config.exclude,
  });

  // Filter through .gitignore rules
  const filtered = files.filter((f) => !ig.ignores(f));

  return filtered.map((relativePath) => {
    const ext = getExtension(relativePath);
    return {
      absolutePath: join(root, relativePath),
      relativePath,
      language: detectLanguage(ext),
      extension: ext,
      isSupport: SUPPORT_PATTERNS.some((p) => p.test(relativePath)),
    };
  });
}

function getExtension(filePath: string): string {
  const match = filePath.match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function detectLanguage(ext: string): string {
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (exts.includes(ext)) return lang;
  }
  return 'unknown';
}
