// archmap — Architecture-as-Code for AI Agents
// Public API

export { scanProject } from './scanner/index.js';
export { loadConfig, createDefaultConfig } from './utils/config.js';
export { generateMarkdown } from './output/markdown-generator.js';
export { writeOutput } from './output/writer.js';
export { integrateWithAgents } from './output/agent-integrator.js';
export { installHook, removeHook } from './git/hook-manager.js';

export type {
  ArchmapConfig,
  ScanResult,
  ScanOptions,
  ModuleInfo,
  ParseResult,
  ImportInfo,
  ExportInfo,
  DependencyGraph,
  DependencyEdge,
  ArchRule,
  ImplicitContract,
} from './types.js';
