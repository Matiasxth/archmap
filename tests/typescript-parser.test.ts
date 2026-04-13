import { describe, it, expect } from 'vitest';
import { parseTypeScript } from '../src/parsers/typescript-parser.js';

describe('TypeScript Parser', () => {
  describe('imports', () => {
    it('extracts named imports', () => {
      const code = `import { foo, bar } from './module';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('./module');
      expect(result.imports[0].specifiers).toEqual(['foo', 'bar']);
      expect(result.imports[0].isRelative).toBe(true);
    });

    it('extracts default imports', () => {
      const code = `import MyComponent from '../components/Button';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toEqual(['MyComponent']);
      expect(result.imports[0].isRelative).toBe(true);
    });

    it('extracts namespace imports', () => {
      const code = `import * as utils from './utils';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toEqual(['utils']);
    });

    it('extracts side-effect imports', () => {
      const code = `import './styles.css';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('./styles.css');
      expect(result.imports[0].specifiers).toEqual([]);
    });

    it('extracts type imports', () => {
      const code = `import type { User } from '../types';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toEqual(['User']);
    });

    it('extracts require calls', () => {
      const code = `const express = require('express');`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('express');
      expect(result.imports[0].isRelative).toBe(false);
    });

    it('extracts destructured require', () => {
      const code = `const { Router } = require('express');`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toEqual(['Router']);
    });

    it('extracts dynamic imports', () => {
      const code = `const mod = await import('./lazy-module');`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].isDynamic).toBe(true);
      expect(result.imports[0].source).toBe('./lazy-module');
    });

    it('distinguishes relative from external imports', () => {
      const code = [
        `import { foo } from './local';`,
        `import axios from 'axios';`,
        `import { join } from 'path';`,
      ].join('\n');
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].isRelative).toBe(true);
      expect(result.imports[1].isRelative).toBe(false);
      expect(result.imports[2].isRelative).toBe(false);
    });

    it('extracts re-exports from source', () => {
      const code = `export { authenticate, authorize } from './auth';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('./auth');
      expect(result.imports[0].specifiers).toEqual(['authenticate', 'authorize']);
    });

    it('extracts export * from source', () => {
      const code = `export * from './types';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toEqual(['*']);
    });
  });

  describe('exports', () => {
    it('extracts exported functions', () => {
      const code = `export function handleRequest() {}`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('handleRequest');
      expect(result.exports[0].type).toBe('function');
    });

    it('extracts exported async functions', () => {
      const code = `export async function fetchData() {}`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports[0].name).toBe('fetchData');
      expect(result.exports[0].type).toBe('function');
    });

    it('extracts exported classes', () => {
      const code = `export class UserService {}`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports[0].name).toBe('UserService');
      expect(result.exports[0].type).toBe('class');
    });

    it('extracts exported interfaces', () => {
      const code = `export interface UserDTO { name: string; }`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports[0].name).toBe('UserDTO');
      expect(result.exports[0].type).toBe('interface');
    });

    it('extracts exported types', () => {
      const code = `export type Role = 'admin' | 'user';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports[0].name).toBe('Role');
      expect(result.exports[0].type).toBe('type');
    });

    it('extracts exported constants', () => {
      const code = `export const MAX_RETRIES = 3;`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports[0].name).toBe('MAX_RETRIES');
      expect(result.exports[0].type).toBe('constant');
    });

    it('extracts default exports', () => {
      const code = `export default function main() {}`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports[0].name).toBe('main');
      expect(result.exports[0].type).toBe('default');
    });

    it('extracts export list', () => {
      const code = `export { foo, bar as baz };`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports).toHaveLength(2);
      expect(result.exports[0].name).toBe('foo');
      expect(result.exports[1].name).toBe('baz');
    });

    it('extracts re-exports as exports too', () => {
      const code = `export { authenticate } from './auth';`;
      const result = parseTypeScript(code, 'test.ts');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('authenticate');
    });
  });

  describe('line numbers', () => {
    it('reports correct line numbers', () => {
      const code = [
        '// header comment',
        '',
        `import { foo } from './bar';`,
        '',
        'export function baz() {}',
      ].join('\n');
      const result = parseTypeScript(code, 'test.ts');
      expect(result.imports[0].line).toBe(3);
      expect(result.exports[0].line).toBe(5);
    });
  });
});
