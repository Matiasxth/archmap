import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface ModuleInfo {
  id: string;
  name: string;
  path: string;
  language: string;
  files: string[];
  publicApi: { exports: Array<{ name: string; type: string; line: number }> };
  internalDependencies: string[];
  externalDependencies: string[];
}

interface ArchRule {
  id: string;
  type: string;
  confidence: number;
  description: string;
}

interface ArchmapData {
  modules: ModuleInfo[];
  rules: ArchRule[];
  manifest: any;
}

let archmapData: ArchmapData | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'archmap.showModule';
  context.subscriptions.push(statusBarItem);

  // Load data
  loadArchmapData();

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('archmap.init', runInit),
    vscode.commands.registerCommand('archmap.scan', runScan),
    vscode.commands.registerCommand('archmap.showModule', showModuleQuickPick),
  );

  // Tree views
  const modulesProvider = new ModulesTreeProvider();
  const rulesProvider = new RulesTreeProvider();
  vscode.window.registerTreeDataProvider('archmap.modules', modulesProvider);
  vscode.window.registerTreeDataProvider('archmap.rules', rulesProvider);

  // Update on file save
  vscode.workspace.onDidSaveTextDocument(() => {
    loadArchmapData();
    modulesProvider.refresh();
    rulesProvider.refresh();
  });

  // Update status bar on editor change
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    updateStatusBar(editor);
  });

  // Hover provider — show module info on hover over imports
  const hoverProvider = vscode.languages.registerHoverProvider(
    ['typescript', 'javascript', 'python', 'go', 'rust', 'java'],
    { provideHover: provideModuleHover },
  );
  context.subscriptions.push(hoverProvider);

  // Initial status bar update
  updateStatusBar(vscode.window.activeTextEditor);

  // File watcher for .archmap changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/.archmap/*.json');
  watcher.onDidChange(() => {
    loadArchmapData();
    modulesProvider.refresh();
    rulesProvider.refresh();
    updateStatusBar(vscode.window.activeTextEditor);
  });
  context.subscriptions.push(watcher);
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function loadArchmapData() {
  const root = getWorkspaceRoot();
  if (!root) return;

  const archmapDir = path.join(root, '.archmap');
  if (!fs.existsSync(archmapDir)) {
    archmapData = null;
    return;
  }

  try {
    const modules = JSON.parse(fs.readFileSync(path.join(archmapDir, 'modules.json'), 'utf-8'));
    const rules = JSON.parse(fs.readFileSync(path.join(archmapDir, 'rules.json'), 'utf-8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(archmapDir, 'manifest.json'), 'utf-8'));
    archmapData = { modules: modules.modules, rules: rules.rules, manifest };
  } catch {
    archmapData = null;
  }
}

function findModuleForFile(filePath: string): ModuleInfo | undefined {
  if (!archmapData) return undefined;
  const root = getWorkspaceRoot();
  if (!root) return undefined;

  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return archmapData.modules.find((m) => m.files.includes(relative));
}

function updateStatusBar(editor: vscode.TextEditor | undefined) {
  if (!editor || !archmapData) {
    statusBarItem.hide();
    return;
  }

  const mod = findModuleForFile(editor.document.uri.fsPath);
  if (mod) {
    const deps = mod.internalDependencies.length;
    const exports = mod.publicApi.exports.length;
    statusBarItem.text = `$(symbol-structure) ${mod.name} (${exports} exports, ${deps} deps)`;
    statusBarItem.tooltip = `Module: ${mod.id}\nLanguage: ${mod.language}\nFiles: ${mod.files.length}\nDeps: ${mod.internalDependencies.join(', ') || 'none'}`;
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function provideModuleHover(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Hover | undefined {
  if (!archmapData) return undefined;

  const mod = findModuleForFile(document.uri.fsPath);
  if (!mod) return undefined;

  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) return undefined;
  const word = document.getText(wordRange);

  // Check if hovering over an exported symbol from another module
  for (const m of archmapData.modules) {
    const exp = m.publicApi.exports.find((e) => e.name === word);
    if (exp && m.id !== mod.id) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**archmap** | Module: \`${m.id}\`\n\n`);
      md.appendMarkdown(`- Type: \`${exp.type}\`\n`);
      md.appendMarkdown(`- Defined in: \`${m.id}\` (line ${exp.line})\n`);
      if (m.internalDependencies.length > 0) {
        md.appendMarkdown(`- Module deps: ${m.internalDependencies.map((d) => `\`${d}\``).join(', ')}\n`);
      }
      return new vscode.Hover(md, wordRange);
    }
  }

  return undefined;
}

async function runInit() {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const terminal = vscode.window.createTerminal('archmap');
  terminal.show();
  terminal.sendText(`npx archmap init --root "${root}"`);
}

async function runScan() {
  const root = getWorkspaceRoot();
  if (!root) return;

  const terminal = vscode.window.createTerminal('archmap');
  terminal.show();
  terminal.sendText(`npx archmap scan --root "${root}"`);
}

async function showModuleQuickPick() {
  if (!archmapData) {
    vscode.window.showWarningMessage('No .archmap/ found. Run "archmap: Initialize" first.');
    return;
  }

  const items = archmapData.modules.map((m) => ({
    label: m.name,
    description: `${m.publicApi.exports.length} exports, ${m.internalDependencies.length} deps`,
    detail: `${m.language} | ${m.files.length} files | deps: ${m.internalDependencies.join(', ') || 'none'}`,
    module: m,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a module to explore',
  });

  if (selected && selected.module.files.length > 0) {
    const root = getWorkspaceRoot()!;
    const firstFile = path.join(root, selected.module.files[0]);
    const doc = await vscode.workspace.openTextDocument(firstFile);
    vscode.window.showTextDocument(doc);
  }
}

// --- Tree View Providers ---

class ModulesTreeProvider implements vscode.TreeDataProvider<ModuleTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ModuleTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() { this._onDidChangeTreeData.fire(undefined); }

  getTreeItem(element: ModuleTreeItem): vscode.TreeItem { return element; }

  getChildren(element?: ModuleTreeItem): ModuleTreeItem[] {
    if (!archmapData) return [];

    if (!element) {
      return archmapData.modules.map((m) => new ModuleTreeItem(
        m.name,
        `${m.publicApi.exports.length} exports`,
        vscode.TreeItemCollapsibleState.Collapsed,
        m,
      ));
    }

    if (element.module) {
      const items: ModuleTreeItem[] = [];

      // Exports
      for (const exp of element.module.publicApi.exports.slice(0, 20)) {
        items.push(new ModuleTreeItem(
          `${exp.name}`,
          exp.type,
          vscode.TreeItemCollapsibleState.None,
        ));
      }

      // Dependencies
      if (element.module.internalDependencies.length > 0) {
        items.push(new ModuleTreeItem(
          '── Dependencies ──',
          '',
          vscode.TreeItemCollapsibleState.None,
        ));
        for (const dep of element.module.internalDependencies) {
          items.push(new ModuleTreeItem(`→ ${dep}`, 'dependency', vscode.TreeItemCollapsibleState.None));
        }
      }

      return items;
    }

    return [];
  }
}

class ModuleTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public module?: ModuleInfo,
  ) {
    super(label, collapsibleState);
    this.description = description;
    if (module) {
      this.iconPath = new vscode.ThemeIcon('symbol-module');
      this.tooltip = `${module.id}\n${module.language} | ${module.files.length} files`;
    }
  }
}

class RulesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() { this._onDidChangeTreeData.fire(undefined); }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(): vscode.TreeItem[] {
    if (!archmapData) return [];

    return archmapData.rules
      .filter((r) => r.confidence >= 0.8)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20)
      .map((rule) => {
        const pct = Math.round(rule.confidence * 100);
        const item = new vscode.TreeItem(`[${pct}%] ${rule.description}`);
        item.iconPath = new vscode.ThemeIcon(
          rule.type === 'boundary' ? 'shield' : rule.type === 'naming-convention' ? 'symbol-text' : 'info',
        );
        item.tooltip = `Type: ${rule.type}\nConfidence: ${pct}%\nSource: ${rule.id}`;
        return item;
      });
  }
}

export function deactivate() {}
