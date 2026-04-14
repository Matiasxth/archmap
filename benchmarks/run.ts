#!/usr/bin/env tsx

/**
 * archmap Benchmark Suite
 *
 * Runs archmap against real open-source repos and measures:
 * - Parse coverage (AST vs regex per language)
 * - Module detection accuracy
 * - Dependency detection count
 * - Rule inference count by tier
 * - Scan duration
 * - Health score
 *
 * Usage: npx tsx benchmarks/run.ts
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { scanProject } from '../src/scanner/index.js';
import { loadConfig, createDefaultConfig } from '../src/utils/config.js';
import type { ArchmapConfig } from '../src/types.js';

interface BenchmarkTarget {
  name: string;
  repo: string;
  language: string;
  moduleRoots: string[];
  languages: string[];
  description: string;
}

const TARGETS: BenchmarkTarget[] = [
  {
    name: 'express',
    repo: 'https://github.com/expressjs/express.git',
    language: 'javascript',
    moduleRoots: ['lib'],
    languages: ['javascript'],
    description: 'Node.js web framework (JS)',
  },
  {
    name: 'fastify',
    repo: 'https://github.com/fastify/fastify.git',
    language: 'javascript',
    moduleRoots: ['lib'],
    languages: ['javascript'],
    description: 'Fast Node.js web framework (JS)',
  },
  {
    name: 'zod',
    repo: 'https://github.com/colinhacks/zod.git',
    language: 'typescript',
    moduleRoots: ['src'],
    languages: ['typescript'],
    description: 'TypeScript schema validation (TS)',
  },
  {
    name: 'flask',
    repo: 'https://github.com/pallets/flask.git',
    language: 'python',
    moduleRoots: ['src'],
    languages: ['python'],
    description: 'Python web framework',
  },
  {
    name: 'gin',
    repo: 'https://github.com/gin-gonic/gin.git',
    language: 'go',
    moduleRoots: ['.'],
    languages: ['go'],
    description: 'Go HTTP framework',
  },
];

const BENCH_DIR = join(import.meta.dirname, 'repos');

interface BenchmarkResult {
  name: string;
  language: string;
  description: string;
  files: number;
  modules: number;
  dependencies: number;
  rules: { total: number; strong: number; conventions: number; observations: number };
  health: number;
  parsing: { ast: number; regex: number; pct: number; regexFiles: string[] };
  duration: number;
  error?: string;
}

async function cloneRepo(target: BenchmarkTarget): Promise<string> {
  const dir = join(BENCH_DIR, target.name);
  if (existsSync(dir)) {
    console.log(`  [cached] ${target.name}`);
    return dir;
  }

  console.log(`  [clone] ${target.name}...`);
  execSync(`git clone --depth 1 ${target.repo} ${dir}`, { stdio: 'pipe' });
  return dir;
}

async function benchmarkRepo(target: BenchmarkTarget): Promise<BenchmarkResult> {
  const dir = await cloneRepo(target);

  const config: ArchmapConfig = {
    version: 1,
    exclude: ['node_modules', 'dist', 'build', '.git', 'vendor', '__pycache__', '.venv', 'test', 'tests', 'spec', 'benchmark', 'benchmarks', 'examples', 'docs'],
    moduleRoots: target.moduleRoots,
    languages: target.languages,
    gitHistory: { maxCommits: 100, minCoChangeConfidence: 0.7, trendWindow: 50 },
    agentIntegration: { updateClaudeMd: false, updateCursorRules: false },
    ruleOverrides: {},
  };

  try {
    const result = await scanProject(dir, {
      gitHistory: false,
      strictAst: false,
      verbose: false,
      config,
    });

    return {
      name: target.name,
      language: target.language,
      description: target.description,
      files: result.stats.totalFiles,
      modules: result.stats.totalModules,
      dependencies: result.stats.totalDependencies,
      rules: {
        total: result.stats.totalRules,
        strong: result.stats.totalStrongRules,
        conventions: result.stats.totalConventions,
        observations: result.stats.totalObservations,
      },
      health: result.health.overall,
      parsing: result.stats.parsing,
      duration: result.manifest.scanDuration,
    };
  } catch (err) {
    return {
      name: target.name,
      language: target.language,
      description: target.description,
      files: 0, modules: 0, dependencies: 0,
      rules: { total: 0, strong: 0, conventions: 0, observations: 0 },
      health: 0,
      parsing: { ast: 0, regex: 0, pct: 0, regexFiles: [] },
      duration: 0,
      error: (err as Error).message,
    };
  }
}

async function main() {
  console.log('archmap Benchmark Suite\n');

  if (!existsSync(BENCH_DIR)) mkdirSync(BENCH_DIR, { recursive: true });

  const results: BenchmarkResult[] = [];

  for (const target of TARGETS) {
    console.log(`\n[${target.name}] ${target.description}`);
    const result = await benchmarkRepo(target);
    results.push(result);

    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
      continue;
    }

    console.log(`  Files:        ${result.files}`);
    console.log(`  Parsing:      ${result.parsing.pct}% AST (${result.parsing.ast} AST, ${result.parsing.regex} regex)`);
    console.log(`  Modules:      ${result.modules}`);
    console.log(`  Dependencies: ${result.dependencies}`);
    console.log(`  Rules:        ${result.rules.strong} rules, ${result.rules.conventions} conv, ${result.rules.observations} obs`);
    console.log(`  Health:       ${result.health}/100`);
    console.log(`  Duration:     ${result.duration}ms`);

    if (result.parsing.regexFiles.length > 0) {
      console.log(`  Regex files:  ${result.parsing.regexFiles.slice(0, 5).join(', ')}${result.parsing.regexFiles.length > 5 ? ` (+${result.parsing.regexFiles.length - 5} more)` : ''}`);
    }
  }

  // Summary table
  console.log('\n\n=== SUMMARY ===\n');
  console.log('| Repo | Language | Files | AST% | Modules | Rules | Health | Time |');
  console.log('|------|----------|-------|------|---------|-------|--------|------|');
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.name} | ${r.language} | ERROR | - | - | - | - | - |`);
    } else {
      console.log(`| ${r.name} | ${r.language} | ${r.files} | ${r.parsing.pct}% | ${r.modules} | ${r.rules.total} | ${r.health} | ${r.duration}ms |`);
    }
  }

  // Write results
  const reportPath = join(import.meta.dirname, 'report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nFull report: ${reportPath}`);

  // Write markdown report
  const mdLines = [
    '# archmap Benchmark Report\n',
    `> Generated: ${new Date().toISOString()}\n`,
    '| Repo | Language | Files | AST% | Modules | Deps | Rules | Conventions | Observations | Health | Duration |',
    '|------|----------|-------|------|---------|------|-------|-------------|-------------|--------|----------|',
  ];
  for (const r of results) {
    if (r.error) {
      mdLines.push(`| ${r.name} | ${r.language} | ERROR | - | - | - | - | - | - | - | - |`);
    } else {
      mdLines.push(`| ${r.name} | ${r.language} | ${r.files} | ${r.parsing.pct}% | ${r.modules} | ${r.dependencies} | ${r.rules.strong} | ${r.rules.conventions} | ${r.rules.observations} | ${r.health}/100 | ${r.duration}ms |`);
    }
  }

  if (results.some((r) => r.parsing.regexFiles.length > 0)) {
    mdLines.push('\n## Regex Fallback Files\n');
    for (const r of results) {
      if (r.parsing.regexFiles.length > 0) {
        mdLines.push(`### ${r.name}\n`);
        for (const f of r.parsing.regexFiles) {
          mdLines.push(`- \`${f}\``);
        }
        mdLines.push('');
      }
    }
  }

  const mdPath = join(import.meta.dirname, 'REPORT.md');
  writeFileSync(mdPath, mdLines.join('\n'));
  console.log(`Markdown report: ${mdPath}`);
}

main().catch(console.error);
