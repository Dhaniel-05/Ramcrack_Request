import * as vscode from 'vscode';
import { GLOBAL_ENV, Store } from './store';
import { ApiRequest, Collection, HistoryEntry } from './types';

// =====================================================================
//  Colecciones
// =====================================================================
export type Node =
  | { kind: 'collection'; collection: Collection }
  | { kind: 'request'; collection: Collection; request: ApiRequest };

export class CollectionsTree implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: Store) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'collection') {
      const item = new vscode.TreeItem(
        node.collection.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = 'collection';
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    const r = node.request;
    const item = new vscode.TreeItem(r.name, vscode.TreeItemCollapsibleState.None);
    item.description = r.method;
    item.tooltip = `${r.method} ${r.url}`;
    item.contextValue = 'request';
    item.iconPath = new vscode.ThemeIcon('symbol-method');
    item.command = {
      command: 'apiRequest.openRequest',
      title: 'Abrir petición',
      arguments: [node.collection.id, r.id],
    };
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.store.getCollections().map((collection) => ({ kind: 'collection', collection }));
    }
    if (node.kind === 'collection') {
      return node.collection.requests.map((request) => ({
        kind: 'request',
        collection: node.collection,
        request,
      }));
    }
    return [];
  }
}

// =====================================================================
//  Entornos y variables
// =====================================================================
export type EnvNode =
  | { kind: 'env'; name: string }
  | { kind: 'var'; env: string; name: string; value: string };

const SECRET_RE = /token|secret|pass|key|auth/i;

export class EnvTree implements vscode.TreeDataProvider<EnvNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: Store) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(node: EnvNode): vscode.TreeItem {
    if (node.kind === 'env') {
      const isGlobal = node.name === GLOBAL_ENV;
      const active = !isGlobal && this.store.activeEnv === node.name;
      const item = new vscode.TreeItem(
        isGlobal ? 'Globales' : node.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = isGlobal ? 'globalEnv' : 'env';
      item.description = isGlobal ? 'todas las colecciones' : active ? 'activo' : '';
      item.iconPath = new vscode.ThemeIcon(isGlobal ? 'globe' : active ? 'check' : 'circle-outline');
      if (!isGlobal) {
        item.command = { command: 'apiRequest.activateEnv', title: 'Activar', arguments: [node] };
      }
      return item;
    }
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.description = SECRET_RE.test(node.name) ? '••••••' : node.value;
    item.tooltip = SECRET_RE.test(node.name) ? node.name : `${node.name} = ${node.value}`;
    item.contextValue = 'envVar';
    item.iconPath = new vscode.ThemeIcon('symbol-variable');
    item.command = { command: 'apiRequest.editEnvVar', title: 'Editar', arguments: [node] };
    return item;
  }

  getChildren(node?: EnvNode): EnvNode[] {
    if (!node) {
      return [
        { kind: 'env', name: GLOBAL_ENV },
        ...this.store.envNames().map((name) => ({ kind: 'env', name }) as EnvNode),
      ];
    }
    if (node.kind === 'env') {
      return Object.entries(this.store.getEnvVars(node.name)).map(
        ([name, value]) => ({ kind: 'var', env: node.name, name, value }) as EnvNode
      );
    }
    return [];
  }
}

// =====================================================================
//  Actividad (historial)
// =====================================================================
export class HistoryTree implements vscode.TreeDataProvider<HistoryEntry> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: Store) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(entry: HistoryEntry): vscode.TreeItem {
    const r = entry.request;
    const item = new vscode.TreeItem(`${r.method} ${r.url || '(sin URL)'}`, vscode.TreeItemCollapsibleState.None);
    const when = new Date(entry.at).toLocaleTimeString();
    item.description = `${entry.status || 'error'} · ${entry.timeMs} ms · ${when}`;
    item.tooltip = `${r.name}\n${r.method} ${r.url}`;
    item.contextValue = 'history';
    item.iconPath = new vscode.ThemeIcon(
      entry.status >= 200 && entry.status < 400 ? 'pass' : 'error',
      new vscode.ThemeColor(
        entry.status >= 200 && entry.status < 400 ? 'testing.iconPassed' : 'testing.iconFailed'
      )
    );
    item.command = { command: 'apiRequest.openHistory', title: 'Abrir', arguments: [entry] };
    return item;
  }

  getChildren(): HistoryEntry[] {
    return this.store.getHistory();
  }
}
