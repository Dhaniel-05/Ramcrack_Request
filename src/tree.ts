import * as vscode from 'vscode';
import { GLOBAL_ENV, Store } from './store';
import { ApiRequest, Collection, Container, Folder, HistoryEntry } from './types';

// =====================================================================
//  Colecciones
// =====================================================================
export type Node =
  | { kind: 'collection'; collection: Collection }
  | { kind: 'folder'; collection: Collection; folder: Folder; parent: Container }
  | { kind: 'request'; collection: Collection; request: ApiRequest; parent: Container };

export const DND_MIME = 'application/vnd.code.tree.apirequest.collections';

interface Dragged {
  kind: 'request' | 'folder';
  collId: string;
  id: string;
}

/**
 * Aplica un arrastre: mueve peticiones y carpetas al destino.
 *  - sobre una colección o carpeta → al final de su contenido;
 *  - sobre una petición → justo antes de ella (en su misma carpeta).
 * Devuelve cuántos elementos se movieron. Las carpetas no se pueden meter dentro de sí mismas.
 */
export function applyDrop(store: Store, items: Dragged[], target: Node | undefined): number {
  if (!target) {
    return 0;
  }
  let moved = 0;
  for (const it of items) {
    if (it.kind === 'request') {
      if (target.kind === 'request') {
        if (target.request.id === it.id) {
          continue;
        }
        const list = store.getContainer(target.collection.id, target.parent.id)?.requests ?? [];
        let index = list.findIndex((r) => r.id === target.request.id);
        // al mover dentro de la misma lista, el índice final se corre si el origen estaba antes
        const from = list.findIndex((r) => r.id === it.id);
        if (from >= 0 && from < index) {
          index--;
        }
        const toContainer = target.parent.id === target.collection.id ? undefined : target.parent.id;
        if (store.moveRequest(it.collId, it.id, target.collection.id, toContainer, index)) {
          moved++;
        }
      } else {
        const toContainer = target.kind === 'folder' ? target.folder.id : undefined;
        if (store.moveRequest(it.collId, it.id, target.collection.id, toContainer)) {
          moved++;
        }
      }
    } else {
      // carpeta: sobre una petición se coloca en la carpeta que la contiene
      const parentId =
        target.kind === 'folder' ? target.folder.id : target.kind === 'request' ? target.parent.id : undefined;
      const toParent = parentId === target.collection.id ? undefined : parentId;
      if (target.kind === 'folder' && target.folder.id === it.id) {
        continue;
      }
      if (store.moveFolder(it.collId, it.id, target.collection.id, toParent)) {
        moved++;
      }
    }
  }
  return moved;
}

export class CollectionsTree
  implements vscode.TreeDataProvider<Node>, vscode.TreeDragAndDropController<Node>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dragMimeTypes = [DND_MIME];
  readonly dropMimeTypes = [DND_MIME];

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
      item.iconPath = new vscode.ThemeIcon('library');
      return item;
    }
    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(
        node.folder.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.id = `folder:${node.folder.id}`;
      item.contextValue = 'folder';
      item.iconPath = new vscode.ThemeIcon('folder');
      return item;
    }
    const r = node.request;
    const item = new vscode.TreeItem(r.name, vscode.TreeItemCollapsibleState.None);
    item.id = `request:${r.id}`;
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
    if (node.kind === 'request') {
      return [];
    }
    const collection = node.collection;
    const parent: Container = node.kind === 'collection' ? node.collection : node.folder;
    // primero las carpetas y luego las peticiones
    return [
      ...parent.folders.map((folder): Node => ({ kind: 'folder', collection, folder, parent })),
      ...parent.requests.map((request): Node => ({ kind: 'request', collection, request, parent })),
    ];
  }

  getParent(node: Node): Node | undefined {
    if (node.kind === 'collection') {
      return undefined;
    }
    if (node.parent.id === node.collection.id) {
      return { kind: 'collection', collection: node.collection };
    }
    const grand = this.findParentOf(node.collection, node.parent.id);
    return { kind: 'folder', collection: node.collection, folder: node.parent as Folder, parent: grand };
  }

  private findParentOf(collection: Collection, folderId: string): Container {
    const visit = (c: Container): Container | undefined => {
      for (const f of c.folders) {
        if (f.id === folderId) {
          return c;
        }
        const r = visit(f);
        if (r) {
          return r;
        }
      }
      return undefined;
    };
    return visit(collection) ?? collection;
  }

  // ---------- arrastrar y soltar ----------
  handleDrag(source: readonly Node[], dataTransfer: vscode.DataTransfer): void {
    const items: Dragged[] = [];
    for (const n of source) {
      if (n.kind === 'request') {
        items.push({ kind: 'request', collId: n.collection.id, id: n.request.id });
      } else if (n.kind === 'folder') {
        items.push({ kind: 'folder', collId: n.collection.id, id: n.folder.id });
      }
    }
    if (items.length) {
      dataTransfer.set(DND_MIME, new vscode.DataTransferItem(JSON.stringify(items)));
    }
  }

  async handleDrop(target: Node | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const raw = dataTransfer.get(DND_MIME);
    if (!raw) {
      return;
    }
    let items: Dragged[];
    try {
      items = JSON.parse(await raw.asString());
    } catch {
      return;
    }
    if (Array.isArray(items)) {
      applyDrop(this.store, items, target);
    }
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
