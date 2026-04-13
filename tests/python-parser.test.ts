import { describe, it, expect } from 'vitest';
import { parsePython } from '../src/parsers/python-parser.js';

describe('Python Parser', () => {
  describe('imports', () => {
    it('extracts from...import statements', () => {
      const code = `from app.models.user import User, Profile`;
      const result = parsePython(code, 'test.py');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('app.models.user');
      expect(result.imports[0].specifiers).toEqual(['User', 'Profile']);
      expect(result.imports[0].isRelative).toBe(false);
    });

    it('extracts relative imports', () => {
      const code = `from .utils import get_config`;
      const result = parsePython(code, 'test.py');
      expect(result.imports[0].source).toBe('.utils');
      expect(result.imports[0].isRelative).toBe(true);
      expect(result.imports[0].specifiers).toEqual(['get_config']);
    });

    it('extracts parent relative imports', () => {
      const code = `from ..models import User`;
      const result = parsePython(code, 'test.py');
      expect(result.imports[0].source).toBe('..models');
      expect(result.imports[0].isRelative).toBe(true);
    });

    it('extracts simple import statements', () => {
      const code = `import os\nimport json`;
      const result = parsePython(code, 'test.py');
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe('os');
      expect(result.imports[1].source).toBe('json');
    });

    it('extracts import with alias', () => {
      const code = `import numpy as np`;
      const result = parsePython(code, 'test.py');
      expect(result.imports[0].source).toBe('numpy');
      expect(result.imports[0].specifiers).toEqual(['np']);
    });

    it('extracts multiline imports', () => {
      const code = `from app.models import (\n    User,\n    Profile,\n    Role\n)`;
      const result = parsePython(code, 'test.py');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toEqual(['User', 'Profile', 'Role']);
    });

    it('handles inline comments in imports', () => {
      const code = `from app.auth import authenticate  # main auth function`;
      const result = parsePython(code, 'test.py');
      expect(result.imports[0].specifiers).toEqual(['authenticate']);
    });
  });

  describe('exports', () => {
    it('extracts class definitions', () => {
      const code = `class UserService:\n    pass`;
      const result = parsePython(code, 'test.py');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('UserService');
      expect(result.exports[0].type).toBe('class');
    });

    it('extracts function definitions', () => {
      const code = `def process_request(data):\n    pass`;
      const result = parsePython(code, 'test.py');
      expect(result.exports[0].name).toBe('process_request');
      expect(result.exports[0].type).toBe('function');
    });

    it('extracts async function definitions', () => {
      const code = `async def fetch_data():\n    pass`;
      const result = parsePython(code, 'test.py');
      expect(result.exports[0].name).toBe('fetch_data');
      expect(result.exports[0].type).toBe('function');
    });

    it('extracts UPPER_CASE constants', () => {
      const code = `MAX_RETRIES = 3\nDEFAULT_TIMEOUT = 30`;
      const result = parsePython(code, 'test.py');
      expect(result.exports).toHaveLength(2);
      expect(result.exports[0].name).toBe('MAX_RETRIES');
      expect(result.exports[0].type).toBe('constant');
    });

    it('skips private definitions (underscore prefix)', () => {
      const code = `def _internal_helper():\n    pass\n\ndef public_function():\n    pass`;
      const result = parsePython(code, 'test.py');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('public_function');
    });

    it('respects __all__ when defined', () => {
      const code = `__all__ = ["User", "get_config"]\n\nclass User:\n    pass\n\ndef get_config():\n    pass\n\ndef internal_helper():\n    pass`;
      const result = parsePython(code, 'test.py');
      expect(result.exports).toHaveLength(2);
      expect(result.exports.map((e) => e.name)).toEqual(['User', 'get_config']);
    });
  });

  describe('line numbers', () => {
    it('reports correct line numbers', () => {
      const code = `# comment\n\nfrom os import path\n\ndef main():\n    pass`;
      const result = parsePython(code, 'test.py');
      expect(result.imports[0].line).toBe(3);
      expect(result.exports[0].line).toBe(5);
    });
  });
});
