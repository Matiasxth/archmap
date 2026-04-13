export interface ArchmapConfig {
  version: number;
  exclude: string[];
  include: string[];
  moduleDetection: 'directory' | 'package';
  moduleRoots: string[];
  languages: string[];
  gitHistory: {
    maxCommits: number;
    minCoChangeConfidence: number;
  };
  agentIntegration: {
    updateClaudeMd: boolean;
    updateCursorRules: boolean;
    summaryPath: string;
  };
}

export interface ParseResult {
  filePath: string;
  language: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isRelative: boolean;
  isDynamic: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'type' | 'interface' | 'constant' | 'default' | 'unknown';
  line: number;
}

export interface ModuleInfo {
  id: string;
  name: string;
  path: string;
  type: 'directory' | 'file';
  language: string;
  files: string[];
  publicApi: {
    exports: ExportInfo[];
  };
  internalDependencies: string[];
  externalDependencies: string[];
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'require' | 'dynamic';
  weight: number;
  references: Array<{
    file: string;
    line: number;
    symbol: string;
  }>;
}

export interface DependencyGraph {
  nodes: Array<{ id: string; label: string; type: 'module' | 'external' }>;
  edges: DependencyEdge[];
  layers: Array<{ name: string; modules: string[] }>;
}

export interface ArchRule {
  id: string;
  type: 'boundary' | 'co-change' | 'naming-convention' | 'layer';
  confidence: number;
  description: string;
  source: 'git-history' | 'static-analysis';
  evidence: Record<string, unknown>;
}

export interface ImplicitContract {
  id: string;
  type: 'co-modification' | 'api-boundary';
  description: string;
  entities: string[];
  confidence: number;
  occurrences: number;
}

export interface ScanResult {
  manifest: {
    version: string;
    generatedAt: string;
    generatedBy: string;
    repoRoot: string;
    languages: string[];
    scanDuration: number;
  };
  stats: {
    totalFiles: number;
    totalModules: number;
    totalDependencies: number;
    totalRules: number;
    totalContracts: number;
  };
  modules: ModuleInfo[];
  dependencies: DependencyGraph;
  rules: ArchRule[];
  contracts: ImplicitContract[];
  parseResults: ParseResult[];
}

export interface ScanOptions {
  gitHistory: boolean;
  verbose: boolean;
  config: ArchmapConfig;
}
