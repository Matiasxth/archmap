import { describe, it, expect } from 'vitest';
import { collectStaticSignals } from '../src/analysis/signals/static-signals.js';
import { detectArchPattern } from '../src/analysis/signals/pattern-detector.js';
import { combineSignals } from '../src/analysis/signals/signal-combiner.js';
import type { ModuleInfo, DependencyGraph, ParseResult } from '../src/types.js';
import type { Signal } from '../src/analysis/signals/types.js';

const makeMod = (id: string, name: string, deps: string[] = [], exports: number = 3, files: string[] = []): ModuleInfo => ({
  id, name, path: id, type: 'directory', language: 'typescript',
  files: files.length > 0 ? files : [`${id}/index.ts`],
  publicApi: { exports: Array.from({ length: exports }, (_, i) => ({ name: `fn${i}`, type: 'function' as const, line: i })) },
  internalDependencies: deps,
  externalDependencies: [],
});

const emptyGraph: DependencyGraph = { nodes: [], edges: [], layers: [] };

describe('Signal-Based Inference', () => {
  describe('static signals', () => {
    it('produces unidirectional signal for one-way dep', () => {
      const modules = [
        makeMod('src/auth', 'auth', ['src/db']),
        makeMod('src/db', 'db', []),
      ];
      const signals = collectStaticSignals(modules, emptyGraph, [], '.');
      const unidir = signals.filter((s) => s.kind === 'unidirectional');
      expect(unidir.length).toBeGreaterThan(0);
      expect(unidir[0].scope).toContain('src/auth');
      expect(unidir[0].scope).toContain('src/db');
    });

    it('produces negative-space signal for selective absences', () => {
      const modules = [
        makeMod('src/api', 'api', ['src/auth', 'src/db', 'src/utils']),
        makeMod('src/auth', 'auth', []),
        makeMod('src/db', 'db', []),
        makeMod('src/utils', 'utils', []),
        makeMod('src/legacy', 'legacy', []),
      ];
      const signals = collectStaticSignals(modules, emptyGraph, [], '.');
      const negSpace = signals.filter((s) => s.kind === 'negative-space');
      // api imports from 3/4 available modules, so the absence of 'legacy' is significant
      expect(negSpace.length).toBeGreaterThan(0);
      const legacyAbsence = negSpace.find((s) => s.scope.includes('src/legacy'));
      expect(legacyAbsence).toBeDefined();
      expect(legacyAbsence!.strength).toBeGreaterThan(0.5);
    });

    it('produces high-fan-in signal for core modules', () => {
      const modules = [
        makeMod('src/utils', 'utils', []),
        makeMod('src/a', 'a', ['src/utils']),
        makeMod('src/b', 'b', ['src/utils']),
        makeMod('src/c', 'c', ['src/utils']),
        makeMod('src/d', 'd', ['src/utils']),
      ];
      const signals = collectStaticSignals(modules, emptyGraph, [], '.');
      const fanIn = signals.filter((s) => s.kind === 'high-fan-in');
      expect(fanIn.length).toBe(1);
      expect(fanIn[0].scope).toContain('src/utils');
      expect(fanIn[0].context.fanIn).toBe(4);
    });
  });

  describe('pattern detector', () => {
    it('detects MVC pattern', () => {
      const modules = [
        makeMod('src/models', 'models', []),
        makeMod('src/views', 'views', ['src/controllers']),
        makeMod('src/controllers', 'controllers', ['src/models']),
      ];
      const { pattern } = detectArchPattern(modules, emptyGraph);
      expect(pattern).not.toBeNull();
      expect(pattern!.name).toBe('mvc');
    });

    it('detects Clean Architecture pattern', () => {
      const modules = [
        makeMod('src/domain', 'domain', []),
        makeMod('src/services', 'services', ['src/domain']),
        makeMod('src/infrastructure', 'infrastructure', ['src/services']),
        makeMod('src/controllers', 'controllers', ['src/services']),
      ];
      const { pattern, signals } = detectArchPattern(modules, emptyGraph);
      expect(pattern).not.toBeNull();
      expect(pattern!.name).toBe('clean-architecture');
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0].kind).toBe('arch-pattern-match');
    });
  });

  describe('signal combiner', () => {
    it('single signal → observation', () => {
      const signals: Signal[] = [{
        kind: 'unidirectional', scope: ['a', 'b'], strength: 0.6,
        description: 'test', context: {},
      }];
      const rules = combineSignals(signals, null);
      expect(rules.length).toBe(1);
      expect(rules[0].tier).toBe('observation');
    });

    it('two different signal kinds → convention', () => {
      const signals: Signal[] = [
        { kind: 'unidirectional', scope: ['a', 'b'], strength: 0.6, description: 'dir', context: {} },
        { kind: 'negative-space', scope: ['a', 'b'], strength: 0.7, description: 'space', context: { selectivity: 0.8 } },
      ];
      const rules = combineSignals(signals, null);
      expect(rules.length).toBe(1);
      expect(rules[0].tier).toBe('convention');
    });

    it('three different signal kinds → rule', () => {
      const signals: Signal[] = [
        { kind: 'unidirectional', scope: ['a', 'b'], strength: 0.7, description: 'dir', context: {} },
        { kind: 'negative-space', scope: ['a', 'b'], strength: 0.8, description: 'space', context: {} },
        { kind: 'high-fan-in', scope: ['a', 'b'], strength: 0.7, description: 'fan', context: {} },
      ];
      const rules = combineSignals(signals, null);
      expect(rules.length).toBe(1);
      expect(rules[0].tier).toBe('rule');
    });

    it('config-boundary signal → always rule', () => {
      const signals: Signal[] = [{
        kind: 'config-boundary', scope: ['*'], strength: 0.95,
        description: 'eslint', context: { configFile: '.eslintrc' },
      }];
      const rules = combineSignals(signals, null);
      expect(rules[0].tier).toBe('rule');
    });

    it('generates contextual actions, not generic templates', () => {
      const signals: Signal[] = [
        { kind: 'negative-space', scope: ['src/api', 'src/legacy'], strength: 0.8, description: 'selective', context: { importCount: 5, selectivity: 0.8 } },
        { kind: 'unidirectional', scope: ['src/api', 'src/legacy'], strength: 0.6, description: 'dir', context: {} },
      ];
      const rules = combineSignals(signals, null);
      expect(rules[0].action).toContain('imports from');
      expect(rules[0].action).toContain('deliberately avoids');
    });

    it('includes signal diversity in evidence', () => {
      const signals: Signal[] = [
        { kind: 'unidirectional', scope: ['a', 'b'], strength: 0.6, description: 'a', context: {} },
        { kind: 'high-fan-in', scope: ['a', 'b'], strength: 0.7, description: 'b', context: {} },
      ];
      const rules = combineSignals(signals, null);
      const details = rules[0].evidence.details as any;
      expect(details.signalKinds).toContain('unidirectional');
      expect(details.signalKinds).toContain('high-fan-in');
      expect(details.uniqueKinds).toBe(2);
    });
  });
});
