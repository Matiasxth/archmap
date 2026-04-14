import { describe, it, expect } from 'vitest';
import { parseGo } from '../src/parsers/go-parser.js';

describe('Go Parser', () => {
  describe('imports', () => {
    it('extracts single import', () => {
      const code = `package main\n\nimport "fmt"`;
      const result = parseGo(code, 'main.go');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('fmt');
      expect(result.imports[0].isRelative).toBe(false);
    });

    it('extracts import block', () => {
      const code = `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n\t"encoding/json"\n)`;
      const result = parseGo(code, 'main.go');
      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].source).toBe('fmt');
      expect(result.imports[1].source).toBe('net/http');
      expect(result.imports[2].source).toBe('encoding/json');
    });

    it('extracts aliased imports', () => {
      const code = `package main\n\nimport (\n\tpg "github.com/lib/pq"\n)`;
      const result = parseGo(code, 'main.go');
      expect(result.imports[0].specifiers).toEqual(['pg']);
    });

    it('marks stdlib imports as non-relative', () => {
      const code = `package main\n\nimport (\n\t"fmt"\n\t"os"\n)`;
      const result = parseGo(code, 'main.go');
      expect(result.imports[0].isRelative).toBe(false);
      expect(result.imports[1].isRelative).toBe(false);
    });

    it('marks dotted imports as relative (potentially internal)', () => {
      const code = `package main\n\nimport "github.com/example/myapp/pkg/auth"`;
      const result = parseGo(code, 'main.go');
      expect(result.imports[0].isRelative).toBe(true);
    });
  });

  describe('exports', () => {
    it('extracts exported functions (capitalized)', () => {
      const code = `package auth\n\nfunc Verify(token string) bool {\n\treturn true\n}`;
      const result = parseGo(code, 'auth.go');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('Verify');
      expect(result.exports[0].type).toBe('function');
    });

    it('ignores unexported functions (lowercase)', () => {
      const code = `package auth\n\nfunc internalHelper() string {\n\treturn ""\n}\n\nfunc PublicFunc() {}`;
      const result = parseGo(code, 'auth.go');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('PublicFunc');
    });

    it('extracts exported types (struct)', () => {
      const code = `package models\n\ntype User struct {\n\tID string\n\tName string\n}`;
      const result = parseGo(code, 'user.go');
      expect(result.exports[0].name).toBe('User');
      expect(result.exports[0].type).toBe('class');
    });

    it('extracts exported interfaces', () => {
      const code = `package repo\n\ntype Repository interface {\n\tFind(id string) error\n}`;
      const result = parseGo(code, 'repo.go');
      expect(result.exports[0].name).toBe('Repository');
      expect(result.exports[0].type).toBe('interface');
    });

    it('extracts exported constants', () => {
      const code = `package config\n\nconst MaxRetries = 3\nvar DBHost = "localhost"`;
      const result = parseGo(code, 'config.go');
      expect(result.exports).toHaveLength(2);
      expect(result.exports[0].name).toBe('MaxRetries');
      expect(result.exports[1].name).toBe('DBHost');
    });

    it('extracts method receivers', () => {
      const code = `package handlers\n\nfunc (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {}`;
      const result = parseGo(code, 'router.go');
      expect(result.exports[0].name).toBe('ServeHTTP');
      expect(result.exports[0].type).toBe('function');
    });

    it('extracts exported names from const block', () => {
      const code = `package status\n\nconst (\n\tActive  = "active"\n\tDeleted = "deleted"\n\tinternal = "hidden"\n)`;
      const result = parseGo(code, 'status.go');
      expect(result.exports).toHaveLength(2);
      expect(result.exports.map((e) => e.name)).toEqual(['Active', 'Deleted']);
    });
  });

  describe('line numbers', () => {
    it('reports correct line numbers', () => {
      const code = `package main\n\nimport "fmt"\n\nfunc Main() {\n\tfmt.Println("hello")\n}`;
      const result = parseGo(code, 'main.go');
      expect(result.imports[0].line).toBe(3);
      expect(result.exports[0].line).toBe(5);
    });
  });
});
