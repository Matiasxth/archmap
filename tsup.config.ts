import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'bin/archmap': 'bin/archmap.ts' },
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    dts: true,
    splitting: false,
    sourcemap: true,
  },
]);
