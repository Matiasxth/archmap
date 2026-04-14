import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import type { ModuleInfo, ArchRule, ImplicitContract, DependencyGraph } from '../types.js';

interface AppProps {
  modules: ModuleInfo[];
  rules: ArchRule[];
  contracts: ImplicitContract[];
  dependencies: DependencyGraph;
  repoRoot: string;
  totalFiles: number;
}

type View = 'modules' | 'module-detail' | 'rules' | 'contracts' | 'deps';

export function App({ modules, rules, contracts, dependencies, repoRoot, totalFiles }: AppProps) {
  const [view, setView] = useState<View>('modules');
  const [selectedModule, setSelectedModule] = useState<ModuleInfo | null>(null);
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q') exit();
    if (key.escape) {
      if (view === 'module-detail') setView('modules');
      else exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header repoRoot={repoRoot} totalFiles={totalFiles} totalModules={modules.length} />

      {view === 'modules' && (
        <ModulesView
          modules={modules}
          onSelect={(mod) => { setSelectedModule(mod); setView('module-detail'); }}
          onSwitchView={setView}
        />
      )}
      {view === 'module-detail' && selectedModule && (
        <ModuleDetailView module={selectedModule} dependencies={dependencies} onBack={() => setView('modules')} />
      )}
      {view === 'rules' && (
        <RulesView rules={rules} onBack={() => setView('modules')} />
      )}
      {view === 'contracts' && (
        <ContractsView contracts={contracts} onBack={() => setView('modules')} />
      )}
      {view === 'deps' && (
        <DepsView dependencies={dependencies} modules={modules} onBack={() => setView('modules')} />
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {view === 'modules' ? '[↑↓] navigate  [enter] select  [r]ules  [c]ontracts  [d]eps  [q]uit' : '[esc] back  [q]uit'}
        </Text>
      </Box>
    </Box>
  );
}

function Header({ repoRoot, totalFiles, totalModules }: { repoRoot: string; totalFiles: number; totalModules: number }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">{'  ◆ archmap'}</Text>
      <Text dimColor>{`  ${repoRoot} — ${totalFiles} files, ${totalModules} modules`}</Text>
    </Box>
  );
}

function ModulesView({ modules, onSelect, onSwitchView }: {
  modules: ModuleInfo[];
  onSelect: (mod: ModuleInfo) => void;
  onSwitchView: (view: View) => void;
}) {
  useInput((input) => {
    if (input === 'r') onSwitchView('rules');
    if (input === 'c') onSwitchView('contracts');
    if (input === 'd') onSwitchView('deps');
  });

  const items = modules.map((mod) => ({
    label: `${mod.name.padEnd(20)} ${String(mod.publicApi.exports.length).padStart(3)} exports  ${String(mod.internalDependencies.length).padStart(2)} deps  ${mod.language}`,
    value: mod.id,
  }));

  return (
    <Box flexDirection="column">
      <Text bold underline>{'  Modules'}</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            const mod = modules.find((m) => m.id === item.value);
            if (mod) onSelect(mod);
          }}
        />
      </Box>
    </Box>
  );
}

function ModuleDetailView({ module: mod, dependencies, onBack }: {
  module: ModuleInfo;
  dependencies: DependencyGraph;
  onBack: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const incomingEdges = dependencies.edges.filter((e) =>
    e.target.startsWith(mod.id + '/') || e.target === mod.id,
  );
  const dependedOnBy = [...new Set(incomingEdges.map((e) => e.source.split('/').slice(0, 2).join('/')))];

  return (
    <Box flexDirection="column">
      <Text bold underline color="cyan">{`  ${mod.id}`}</Text>
      <Text dimColor>{`  ${mod.language} — ${mod.files.length} files`}</Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold>{'  Public API:'}</Text>
        {mod.publicApi.exports.slice(0, 15).map((exp, i) => (
          <Text key={i}>{`    ${exp.name} (${exp.type})`}</Text>
        ))}
        {mod.publicApi.exports.length > 15 && (
          <Text dimColor>{`    ... and ${mod.publicApi.exports.length - 15} more`}</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>{'  Depends on:'}</Text>
        {mod.internalDependencies.length > 0
          ? mod.internalDependencies.map((dep, i) => <Text key={i} color="yellow">{`    → ${dep}`}</Text>)
          : <Text dimColor>{'    (none)'}</Text>
        }
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>{'  Depended on by:'}</Text>
        {dependedOnBy.length > 0
          ? dependedOnBy.map((dep, i) => <Text key={i} color="green">{`    ← ${dep}`}</Text>)
          : <Text dimColor>{'    (none)'}</Text>
        }
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>{'  External deps:'}</Text>
        {mod.externalDependencies.length > 0
          ? mod.externalDependencies.map((dep, i) => <Text key={i} dimColor>{`    ${dep}`}</Text>)
          : <Text dimColor>{'    (none)'}</Text>
        }
      </Box>
    </Box>
  );
}

function RulesView({ rules, onBack }: { rules: ArchRule[]; onBack: () => void }) {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const sorted = [...rules]
    .filter((r) => r.confidence >= 0.75)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20);

  return (
    <Box flexDirection="column">
      <Text bold underline>{'  Architectural Rules'}</Text>
      <Box marginTop={1} flexDirection="column">
        {sorted.map((rule, i) => {
          const pct = Math.round(rule.confidence * 100);
          const color = pct >= 90 ? 'green' : pct >= 80 ? 'yellow' : 'red';
          return (
            <Box key={i} marginBottom={0}>
              <Text color={color}>{`  [${String(pct).padStart(3)}%] `}</Text>
              <Text>{rule.description}</Text>
            </Box>
          );
        })}
        {sorted.length === 0 && <Text dimColor>{'  No high-confidence rules found.'}</Text>}
      </Box>
    </Box>
  );
}

function ContractsView({ contracts, onBack }: { contracts: ImplicitContract[]; onBack: () => void }) {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const sorted = [...contracts].sort((a, b) => b.confidence - a.confidence).slice(0, 20);

  return (
    <Box flexDirection="column">
      <Text bold underline>{'  Implicit Contracts (co-change patterns)'}</Text>
      <Box marginTop={1} flexDirection="column">
        {sorted.map((c, i) => (
          <Box key={i} marginBottom={0}>
            <Text color="magenta">{`  [${c.occurrences}x] `}</Text>
            <Text>{c.description}</Text>
          </Box>
        ))}
        {sorted.length === 0 && <Text dimColor>{'  No co-change patterns found. Run with git history enabled.'}</Text>}
      </Box>
    </Box>
  );
}

function DepsView({ dependencies, modules, onBack }: {
  dependencies: DependencyGraph;
  modules: ModuleInfo[];
  onBack: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column">
      <Text bold underline>{'  Dependency Graph'}</Text>

      {dependencies.layers.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>{'  Layers (top = least dependencies):'}</Text>
          {dependencies.layers.map((layer, i) => (
            <Box key={i}>
              <Text dimColor>{`  ${String(i + 1).padStart(2)}. `}</Text>
              <Text bold>{layer.name.padEnd(12)}</Text>
              <Text>{layer.modules.join(', ')}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>{'  Module dependencies:'}</Text>
        {modules.map((mod, i) => (
          mod.internalDependencies.length > 0 ? (
            <Box key={i}>
              <Text color="cyan">{`  ${mod.name.padEnd(20)}`}</Text>
              <Text>{'→ '}</Text>
              <Text color="yellow">{mod.internalDependencies.map((d) => d.split('/').pop()).join(', ')}</Text>
            </Box>
          ) : null
        ))}
      </Box>
    </Box>
  );
}
