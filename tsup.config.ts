import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'bin/archmap': 'bin/archmap.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  dts: { entry: 'src/index.ts' },
  splitting: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
