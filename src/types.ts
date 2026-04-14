// --- Config ---

export interface ArchmapConfig {
  version: number;
  exclude: string[];
  moduleRoots: string[];
  languages: string[];
  gitHistory: {
    maxCommits: number;
    minCoChangeConfidence: number;
    trendWindow: number;
  };
  agentIntegration: {
    updateClaudeMd: boolean;
    updateCursorRules: boolean;
  };
  ruleOverrides: Record<string, 'suppress' | 'promote:rule' | 'promote:convention'>;
}

// --- Parsing ---

export type ParseMethod = 'ast' | 'regex';

export interface ParseResult {
  filePath: string;
  language: string;
  parseMethod: ParseMethod;
  isSupport?: boolean;
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

// --- Modules ---

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

// --- Dependencies ---

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

// --- Rules (Schema v2) ---

export type RuleCategory = 'boundary' | 'co-change' | 'naming' | 'layer' | 'ownership';
export type RuleTier = 'observation' | 'convention' | 'rule';
export type RuleTrend = 'stable' | 'strengthening' | 'weakening' | 'broken' | 'new';
export type RuleSource = 'git-history' | 'static-analysis' | 'manual';

export interface ArchRule {
  id: string;
  category: RuleCategory;
  tier: RuleTier;
  confidence: number;
  trend: RuleTrend;
  scope: string[];
  description: string;
  action: string;
  source: RuleSource;
  evidence: RuleEvidence;
  conflicts?: string[];

  // Deprecated v1 compat — kept for migration
  type?: string;
}

export interface RuleEvidence {
  firstSeen: string;
  commitsSampled: number;
  recentViolations: number;
  totalInstances: number;
  matchingInstances: number;
  promotedFrom?: RuleTier;
  details?: Record<string, unknown>;
}

// --- Implicit Contracts ---

export interface ImplicitContract {
  id: string;
  type: 'co-modification' | 'api-boundary';
  description: string;
  entities: string[];
  confidence: number;
  occurrences: number;
}

// --- Health Score ---

export interface HealthScore {
  overall: number; // 0-100
  trend: RuleTrend;
  breakdown: {
    observations: { total: number; };
    conventions: { total: number; violations: number; };
    rules: { total: number; violations: number; };
  };
  moduleScores: Array<{
    moduleId: string;
    score: number;
    violations: number;
  }>;
}

// --- Resource Chains ---

export interface ResourceChain {
  resource: string;
  links: ResourceChainLink[];
  languages: string[];
  isCrossStack: boolean;
}

export interface ResourceChainLink {
  file: string;
  role: string;
  language: string;
}

// --- File-Level Analysis ---

export interface FileRisk {
  file: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  transitiveImpact: number;
  fanIn: number;
  changeFrequency: number;
  isOnCriticalPath: boolean;
  hasTests: boolean;
  testFiles: string[];
}

export interface CriticalPath {
  files: string[];
  length: number;
  rootFile: string;
  leafFile: string;
}

export interface HotFile {
  file: string;
  importance: number;
  risk: FileRisk['risk'];
  fanIn: number;
  transitiveImpact: number;
  module: string;
}

export interface ArchDelta {
  newDependencies: Array<{ from: string; to: string }>;
  removedDependencies: Array<{ from: string; to: string }>;
  newModules: string[];
  removedModules: string[];
  riskChanges: Array<{ file: string; before: string; after: string }>;
  ruleChanges: { added: number; removed: number; promoted: number; demoted: number };
}

// --- Scan Result ---

export interface ScanResult {
  schemaVersion: number;
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
    totalObservations: number;
    totalConventions: number;
    totalStrongRules: number;
    parsing: {
      ast: number;
      regex: number;
      pct: number;
      regexFiles: string[]; // file paths that fell to regex fallback
    };
  };
  health: HealthScore;
  modules: ModuleInfo[];
  dependencies: DependencyGraph;
  rules: ArchRule[];
  contracts: ImplicitContract[];
  parseResults: ParseResult[];
  fileRisks: FileRisk[];
  criticalPaths: CriticalPath[];
  hotFiles: HotFile[];
  resourceChains: ResourceChain[];
  insights: Array<{
    severity: 'info' | 'warning' | 'critical';
    id: string;
    file?: string;
    module?: string;
    metric: string;
    description: string;
    action: string;
  }>;
}

export interface ScanOptions {
  gitHistory: boolean;
  verbose: boolean;
  strictAst?: boolean;
  config: ArchmapConfig;
}
