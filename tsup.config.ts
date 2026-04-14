import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const define = { 'globalThis.__ARCHMAP_VERSION__': JSON.stringify(pkg.version) };

export default defineConfig([
  {
    entry: { 'bin/archmap': 'bin/archmap.ts', 'bin/archmap-mcp': 'bin/archmap-mcp.ts' },
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    define,
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    dts: true,
    splitting: false,
    sourcemap: true,
    define,
  },
]);
