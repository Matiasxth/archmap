import { describe, it, expect } from 'vitest';
import { parseRust } from '../src/parsers/rust-parser.js';

describe('Rust Parser', () => {
  describe('imports', () => {
    it('extracts simple use statements', () => {
      const code = `use std::collections::HashMap;`;
      const result = parseRust(code, 'main.rs');
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe('std::collections::HashMap');
      expect(result.imports[0].specifiers).toEqual(['HashMap']);
      expect(result.imports[0].isRelative).toBe(false);
    });

    it('extracts crate-relative imports', () => {
      const code = `use crate::auth::verify_token;`;
      const result = parseRust(code, 'main.rs');
      expect(result.imports[0].isRelative).toBe(true);
      expect(result.imports[0].source).toBe('crate::auth::verify_token');
    });

    it('extracts self:: imports', () => {
      const code = `use self::utils::helper;`;
      const result = parseRust(code, 'lib.rs');
      expect(result.imports[0].isRelative).toBe(true);
    });

    it('extracts super:: imports', () => {
      const code = `use super::config::Settings;`;
      const result = parseRust(code, 'sub/mod.rs');
      expect(result.imports[0].isRelative).toBe(true);
    });

    it('extracts use block (single line)', () => {
      const code = `use std::io::{Read, Write, BufReader};`;
      const result = parseRust(code, 'main.rs');
      expect(result.imports).toHaveLength(3);
      expect(result.imports.map((i) => i.specifiers[0])).toEqual(['Read', 'Write', 'BufReader']);
    });

    it('extracts multiline use block', () => {
      const code = `use crate::models::{\n    User,\n    Role,\n    Permission,\n};`;
      const result = parseRust(code, 'main.rs');
      expect(result.imports).toHaveLength(3);
      expect(result.imports.map((i) => i.specifiers[0])).toEqual(['User', 'Role', 'Permission']);
    });

    it('extracts mod declarations', () => {
      const code = `mod auth;\nmod db;\nmod routes;`;
      const result = parseRust(code, 'lib.rs');
      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].source).toBe('auth');
      expect(result.imports[0].isRelative).toBe(true);
    });

    it('extracts aliased use', () => {
      const code = `use std::collections::HashMap as Map;`;
      const result = parseRust(code, 'main.rs');
      expect(result.imports[0].specifiers).toEqual(['Map']);
    });

    it('extracts glob imports', () => {
      const code = `use crate::prelude::*;`;
      const result = parseRust(code, 'main.rs');
      expect(result.imports[0].specifiers).toEqual(['*']);
    });
  });

  describe('exports', () => {
    it('extracts pub fn', () => {
      const code = `pub fn process(data: &str) -> Result<(), Error> {}`;
      const result = parseRust(code, 'lib.rs');
      expect(result.exports[0].name).toBe('process');
      expect(result.exports[0].type).toBe('function');
    });

    it('extracts pub async fn', () => {
      const code = `pub async fn fetch_data() -> Vec<u8> {}`;
      const result = parseRust(code, 'lib.rs');
      expect(result.exports[0].name).toBe('fetch_data');
    });

    it('extracts pub struct', () => {
      const code = `pub struct Config {\n    host: String,\n    port: u16,\n}`;
      const result = parseRust(code, 'config.rs');
      expect(result.exports[0].name).toBe('Config');
      expect(result.exports[0].type).toBe('class');
    });

    it('extracts pub enum', () => {
      const code = `pub enum Status {\n    Active,\n    Inactive,\n}`;
      const result = parseRust(code, 'types.rs');
      expect(result.exports[0].name).toBe('Status');
      expect(result.exports[0].type).toBe('type');
    });

    it('extracts pub trait', () => {
      const code = `pub trait Repository {\n    fn find(&self, id: &str) -> Option<Entity>;\n}`;
      const result = parseRust(code, 'repo.rs');
      expect(result.exports[0].name).toBe('Repository');
      expect(result.exports[0].type).toBe('interface');
    });

    it('extracts pub const', () => {
      const code = `pub const MAX_RETRIES: u32 = 3;`;
      const result = parseRust(code, 'config.rs');
      expect(result.exports[0].name).toBe('MAX_RETRIES');
      expect(result.exports[0].type).toBe('constant');
    });

    it('extracts pub static', () => {
      const code = `pub static GLOBAL_CONFIG: Lazy<Config> = Lazy::new(|| Config::default());`;
      const result = parseRust(code, 'config.rs');
      expect(result.exports[0].name).toBe('GLOBAL_CONFIG');
    });

    it('ignores non-pub items', () => {
      const code = `fn private_fn() {}\nstruct InternalStruct {}\npub fn public_fn() {}`;
      const result = parseRust(code, 'lib.rs');
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('public_fn');
    });

    it('handles pub(crate) visibility', () => {
      const code = `pub(crate) fn internal_api() {}`;
      const result = parseRust(code, 'lib.rs');
      expect(result.exports[0].name).toBe('internal_api');
    });
  });
});
