import { describe, it, expect } from 'vitest';
import { parseJava } from '../src/parsers/java-parser.js';

describe('Java Parser', () => {
  describe('imports', () => {
    it('extracts simple imports', () => {
      const code = `package com.example.app;\n\nimport com.example.service.UserService;`;
      const result = parseJava(code, 'App.java');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('com.example.service');
      expect(result.imports[0].specifiers).toEqual(['UserService']);
    });

    it('extracts wildcard imports', () => {
      const code = `import java.util.*;`;
      const result = parseJava(code, 'App.java');
      expect(result.imports[0].source).toBe('java.util');
      expect(result.imports[0].specifiers).toEqual(['*']);
    });

    it('extracts static imports', () => {
      const code = `import static org.junit.Assert.assertEquals;`;
      const result = parseJava(code, 'Test.java');
      expect(result.imports[0].specifiers).toEqual(['assertEquals']);
    });

    it('marks same-project imports as relative', () => {
      const code = `package com.example.app;\n\nimport com.example.auth.AuthService;\nimport org.springframework.web.bind.annotation.RestController;`;
      const result = parseJava(code, 'App.java');
      expect(result.imports[0].isRelative).toBe(true);  // same root: com.example
      expect(result.imports[1].isRelative).toBe(false);  // different: org.springframework
    });

    it('handles multiple imports', () => {
      const code = `import java.util.List;\nimport java.util.Map;\nimport java.io.File;`;
      const result = parseJava(code, 'App.java');
      expect(result.imports).toHaveLength(3);
    });
  });

  describe('exports', () => {
    it('extracts public class', () => {
      const code = `public class UserController {}`;
      const result = parseJava(code, 'UserController.java');
      expect(result.exports[0].name).toBe('UserController');
      expect(result.exports[0].type).toBe('class');
    });

    it('extracts public abstract class', () => {
      const code = `public abstract class BaseService {}`;
      const result = parseJava(code, 'BaseService.java');
      expect(result.exports[0].name).toBe('BaseService');
      expect(result.exports[0].type).toBe('class');
    });

    it('extracts public interface', () => {
      const code = `public interface UserRepository {}`;
      const result = parseJava(code, 'UserRepository.java');
      expect(result.exports[0].name).toBe('UserRepository');
      expect(result.exports[0].type).toBe('interface');
    });

    it('extracts public enum', () => {
      const code = `public enum Role {\n    ADMIN,\n    USER\n}`;
      const result = parseJava(code, 'Role.java');
      expect(result.exports[0].name).toBe('Role');
      expect(result.exports[0].type).toBe('type');
    });

    it('extracts public record (Java 16+)', () => {
      const code = `public record UserDTO(String name, String email) {}`;
      const result = parseJava(code, 'UserDTO.java');
      expect(result.exports[0].name).toBe('UserDTO');
      expect(result.exports[0].type).toBe('class');
    });

    it('extracts public static final constants', () => {
      const code = `public static final String API_VERSION = "v1";`;
      const result = parseJava(code, 'Constants.java');
      expect(result.exports[0].name).toBe('API_VERSION');
      expect(result.exports[0].type).toBe('constant');
    });

    it('extracts public methods', () => {
      const code = `    public List<User> findAll() {\n        return users;\n    }`;
      const result = parseJava(code, 'Service.java');
      expect(result.exports[0].name).toBe('findAll');
      expect(result.exports[0].type).toBe('function');
    });

    it('ignores non-public members', () => {
      const code = `class Internal {}\nprivate void helper() {}\npublic class Public {}`;
      const result = parseJava(code, 'File.java');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('Public');
    });

    it('handles block comments correctly', () => {
      const code = `/*\n * This is a comment\n * public class NotReal {}\n */\npublic class Real {}`;
      const result = parseJava(code, 'File.java');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('Real');
    });
  });
});
