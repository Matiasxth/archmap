/**
 * Signal-based architecture inference.
 *
 * Signals are raw observations from different analyzers.
 * They are NOT rules — rules emerge from the convergence of multiple signals.
 *
 * Signal → combined → Rule only when multiple independent signals agree.
 */

export type SignalKind =
  | 'no-import'              // A does not import B (static)
  | 'unidirectional'         // A→B exists, B→A does not
  | 'co-change'              // Files change together in git history
  | 'removed-dependency'     // A→B existed in git history but was removed
  | 'naming-pattern'         // Files in a directory follow a naming convention
  | 'layer-position'         // Module sits in a detected layer
  | 'negative-space'         // Module imports from most peers except specific ones
  | 'high-fan-in'            // Module has many dependents (stable core)
  | 'unstable-hotspot'       // High fan-in + high change frequency = risk
  | 'narrow-api'             // Module exports few symbols relative to internal code
  | 'unused-exports'         // Exports that no other module imports
  | 'config-boundary'        // eslint/tsconfig defines import restrictions
  | 'test-alignment'         // Test directory mirrors source directory
  | 'arch-pattern-match'     // Module matches a known architectural pattern
  | 'change-frequency';      // Module change rate relative to project

export interface Signal {
  kind: SignalKind;
  scope: string[];           // Module IDs this signal applies to
  strength: number;          // 0-1, quality of this individual signal
  description: string;       // Human-readable description of what was observed
  context: SignalContext;     // Specific data for contextual action generation
}

export interface SignalContext {
  // Common fields
  modules?: string[];
  files?: string[];

  // For no-import / unidirectional / negative-space
  importCount?: number;       // How many other modules the source imports
  absentCount?: number;       // How many modules it could import but doesn't
  selectivity?: number;       // importCount / totalAvailable

  // For co-change
  coChangeCount?: number;
  jaccardCoefficient?: number;

  // For removed-dependency
  addedInCommit?: string;
  removedInCommit?: string;
  commitMessage?: string;

  // For stability metrics
  fanIn?: number;
  fanOut?: number;
  instability?: number;       // fanOut / (fanIn + fanOut)
  changeFrequency?: number;   // changes per 100 commits

  // For export surface
  totalExports?: number;
  usedExternally?: number;
  unusedExports?: number;
  apiNarrowness?: number;

  // For naming patterns
  pattern?: string;
  matchCount?: number;
  totalCount?: number;
  exceptions?: string[];

  // For architectural pattern
  detectedPattern?: string;
  patternConfidence?: number;
  expectedRule?: string;

  // For config boundaries
  configFile?: string;
  configRule?: string;

  // For test alignment
  testDir?: string;
  sourceDir?: string;

  // Raw details
  details?: Record<string, unknown>;
}

/**
 * Detected architectural pattern for the project.
 */
export interface ArchPattern {
  name: string;              // 'clean-architecture', 'mvc', 'hexagonal', 'feature-based'
  confidence: number;        // 0-1
  layers: ArchPatternLayer[];
  rules: ArchPatternRule[];
}

export interface ArchPatternLayer {
  name: string;
  modules: string[];
  level: number;             // 0 = innermost/core, higher = outer
}

export interface ArchPatternRule {
  description: string;
  from: string;              // Layer or module pattern
  to: string;                // Layer or module pattern
  direction: 'forbidden' | 'allowed';
}
