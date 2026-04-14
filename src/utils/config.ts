import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ArchmapConfig } from '../types.js';

const DEFAULT_CONFIG: ArchmapConfig = {
  version: 1,
  exclude: ['node_modules', 'dist', 'build', '.git', 'vendor', '__pycache__', '.venv', 'coverage'],
  moduleRoots: ['src', 'lib', 'app', 'packages'],
  languages: ['typescript', 'javascript', 'python', 'go', 'rust', 'java'],
  gitHistory: {
    maxCommits: 1000,
    minCoChangeConfidence: 0.7,
    trendWindow: 100,
  },
  agentIntegration: {
    updateClaudeMd: true,
    updateCursorRules: false,
  },
  ruleOverrides: {},
};

export async function loadConfig(root: string): Promise<ArchmapConfig> {
  const configPath = join(root, '.archmap', 'config.json');

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = await readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function createDefaultConfig(root: string): Promise<void> {
  const archmapDir = join(root, '.archmap');
  const configPath = join(archmapDir, 'config.json');

  if (existsSync(configPath)) return;

  if (!existsSync(archmapDir)) {
    await mkdir(archmapDir, { recursive: true });
  }

  await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
}
