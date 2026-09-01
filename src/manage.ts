import * as vscode from 'vscode';
import { Cfg } from './config';
import { getSharedTerminal } from './terminal';

/**
 * Manage Resources — the plugin "home" view (replaces the old Quick Build
 * tree). Full-height, closable, lists resource/project entry points.
 */
export class ManageResourcesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(e: vscode.TreeItem): vscode.TreeItem {
    return e;
  }
  getChildren(): vscode.TreeItem[] {
    const mk = (label: string, cmd: string, icon: string, desc: string) => {
      const t = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      t.description = desc;
      t.command = { command: cmd, title: label };
      t.iconPath = new vscode.ThemeIcon(icon);
      return t;
    };
    return [
      mk('Manage Toolchains', 'quecpi.manageToolchains', 'tools', 'build toolchain settings'),
      mk('Manage SDKs', 'quecpi.manageSdks', 'library', 'select SDK / BSP path'),
      mk('Open an existing application', 'quecpi.openApp', 'folder-opened', 'open a project folder'),
      mk('Create a new application', 'quecpi.newApp', 'file-add', 'scaffold a new app'),
      mk('Create a new board', 'quecpi.newBoard', 'circuit-board', 'add a board definition'),
      mk('Browse Samples', 'quecpi.browseSamples', 'globe', 'Quectel-Pi sample projects'),
      mk('Open terminal', 'quecpi.openTerminal', 'terminal', 'shared host terminal'),
    ];
  }
}

/** Register the Manage Resources commands. Returns the disposables. */
export function registerManageCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('quecpi.openTerminal', () => {
      const term = getSharedTerminal('QuecPi Terminal');
      term.show();
    }),
    vscode.commands.registerCommand('quecpi.openApp', async () => {
      const r = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Open Application' });
      if (r && r.length) {
        await vscode.commands.executeCommand('vscode.openFolder', r[0]);
      }
    }),
    vscode.commands.registerCommand('quecpi.browseSamples', () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/Quectel-Pi'));
    }),
    vscode.commands.registerCommand('quecpi.manageSdks', () => {
      const bsp = Cfg.bspPath();
      if (bsp) {
        void vscode.window.showInformationMessage(`QuecPi BSP/SDK: ${bsp}`);
      } else {
        void vscode.window.showWarningMessage('QuecPi: no BSP workspace folder open. Open the SDK folder first.');
      }
    }),
    vscode.commands.registerCommand('quecpi.manageToolchains', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'quecpi.build');
    }),
    vscode.commands.registerCommand('quecpi.newApp', () => {
      void vscode.window.showInformationMessage('Create a new application — not implemented yet.');
    }),
    vscode.commands.registerCommand('quecpi.newBoard', () => {
      void vscode.window.showInformationMessage('Create a new board — not implemented yet.');
    }),
  ];
}
