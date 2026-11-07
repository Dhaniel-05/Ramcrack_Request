import * as vscode from 'vscode';
import * as fs from 'fs';
import { Store } from './store';
import { Container, Folder } from './types';
import { CollectionsTree, EnvNode, EnvTree, HistoryTree, Node } from './tree';
import { RequestPanel } from './panel';
import { HistoryEntry } from './types';
import { countImported, parseCollectionJson, parseCurl } from './importers';

/**
 * Punto de entrada. Registra un canal de salida "Ramcrack Request" y, si el arranque falla,
 * muestra el motivo exacto en un mensaje (en vez de dejar los botones sin respuesta).
 */
export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Ramcrack Request');
  context.subscriptions.push(log);
  const version = (context.extension.packageJSON as { version?: string }).version;
  log.appendLine(`Iniciando Ramcrack Request v${version} en ${vscode.env.appName} ${vscode.version}`);
  try {
    start(context, log);
    log.appendLine('Extensión iniciada correctamente.');
  } catch (e) {
    const err = e as Error;
    log.appendLine(`ERROR al iniciar: ${err?.stack || err?.message || String(e)}`);
    vscode.window
      .showErrorMessage(`Ramcrack Request no pudo iniciar: ${err?.message || String(e)}`, 'Ver detalles')
      .then((pick) => pick && log.show());
    throw e;
  }
}

function start(context: vscode.ExtensionContext, log: vscode.OutputChannel) {
  const store = new Store(context);
  log.appendLine(`Datos en: ${store.collectionsPath()}`);

  const collectionsTree = new CollectionsTree(store);
  context.subscriptions.push(
    vscode.window.createTreeView('apiRequest.collections', {
      treeDataProvider: collectionsTree,
      dragAndDropController: collectionsTree,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView('apiRequest.environments', {
      treeDataProvider: new EnvTree(store),
    }),
    vscode.window.createTreeView('apiRequest.history', {
      treeDataProvider: new HistoryTree(store),
    })
  );

  // Barra de estado con el entorno activo
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.command = 'apiRequest.selectEnvironment';
  const updateStatus = () => {
    status.text = `$(globe) Ramcrack: ${store.activeEnv || 'sin entorno'}`;
    status.tooltip = 'Ramcrack Request: cambiar entorno';
    status.show();
  };
  updateStatus();
  context.subscriptions.push(
    status,
    store.onDidChange(() => {
      updateStatus();
      RequestPanel.refresh(store);
    })
  );

  const register = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // =====================================================================
  //  Colecciones y peticiones
  // =====================================================================
  register('apiRequest.newCollection', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Nombre de la colección',
      placeHolder: 'Mi API',
    });
    if (name?.trim()) {
      store.addCollection(name.trim());
    }
  });

  // Abre una petición vacía al instante, sin preguntar nada.
  // Dentro de una carpeta si se pulsa su "+"; si no hay colecciones se crea "Mis peticiones".
  register('apiRequest.newRequest', (node?: Node) => {
    const collId = node?.collection.id ?? defaultCollection(store).id;
    const containerId =
      node?.kind === 'folder'
        ? node.folder.id
        : node?.kind === 'request' && node.parent.id !== collId
          ? node.parent.id
          : undefined;
    const req = store.addRequest(collId, DEFAULT_NAME, undefined, containerId);
    if (req) {
      RequestPanel.open(context, store, collId, req.id);
    }
  });

  register('apiRequest.newFolder', async (node?: Node) => {
    let target: { collId: string; containerId?: string } | undefined;
    if (node?.kind === 'collection') {
      target = { collId: node.collection.id };
    } else if (node?.kind === 'folder') {
      target = { collId: node.collection.id, containerId: node.folder.id };
    } else if (node?.kind === 'request') {
      target = { collId: node.collection.id, containerId: node.parent.id === node.collection.id ? undefined : node.parent.id };
    } else {
      target = await pickContainer(store, 'Dónde crear la carpeta');
    }
    if (!target) {
      return;
    }
    const name = await vscode.window.showInputBox({ prompt: 'Nombre de la carpeta', placeHolder: 'Autenticación' });
    if (name?.trim()) {
      store.addFolder(target.collId, name.trim(), target.containerId);
    }
  });

  register('apiRequest.openRequest', (collId: string, reqId: string) =>
    RequestPanel.open(context, store, collId, reqId)
  );

  register('apiRequest.rename', async (node?: Node) => {
    if (!node) {
      return;
    }
    const current = node.kind === 'collection' ? node.collection.name : node.kind === 'folder' ? node.folder.name : node.request.name;
    const name = await vscode.window.showInputBox({ prompt: 'Nuevo nombre', value: current });
    if (!name?.trim()) {
      return;
    }
    if (node.kind === 'collection') {
      store.renameCollection(node.collection.id, name.trim());
    } else if (node.kind === 'folder') {
      store.renameFolder(node.collection.id, node.folder.id, name.trim());
    } else {
      const req = store.getRequest(node.collection.id, node.request.id);
      if (req) {
        req.name = name.trim();
        store.updateRequest(node.collection.id, req);
      }
    }
  });

  register('apiRequest.duplicate', (node?: Node) => {
    if (node?.kind === 'request') {
      store.duplicateRequest(node.collection.id, node.request.id);
    } else if (node?.kind === 'folder') {
      store.duplicateFolder(node.collection.id, node.folder.id);
    }
  });

  register('apiRequest.delete', async (node?: Node) => {
    if (!node) {
      return;
    }
    const label = node.kind === 'collection' ? node.collection.name : node.kind === 'folder' ? node.folder.name : node.request.name;
    let detail: string | undefined;
    const content = node.kind === 'collection' ? node.collection : node.kind === 'folder' ? node.folder : undefined;
    if (content) {
      const n = countImported(content);
      if (n.requests || n.folders) {
        detail = `Se eliminará también su contenido: ${n.requests} petición(es) y ${n.folders} carpeta(s). No se puede deshacer.`;
      }
    }
    const ok = await vscode.window.showWarningMessage(`¿Eliminar "${label}"?`, { modal: true, detail }, 'Eliminar');
    if (ok !== 'Eliminar') {
      return;
    }
    if (node.kind === 'collection') {
      store.deleteCollection(node.collection.id);
    } else if (node.kind === 'folder') {
      store.deleteFolder(node.collection.id, node.folder.id);
    } else {
      store.deleteRequest(node.collection.id, node.request.id);
    }
  });

  // "Mover a…": alternativa a arrastrar y soltar (también sirve con el teclado)
  register('apiRequest.moveTo', async (node?: Node) => {
    if (!node || node.kind === 'collection') {
      return;
    }
    const excluded = new Set<string>();
    if (node.kind === 'folder') {
      collectIds(node.folder, excluded); // no se puede mover dentro de sí misma ni de sus subcarpetas
    }
    const target = await pickContainer(store, 'Mover a…', excluded);
    if (!target) {
      return;
    }
    if (node.kind === 'request') {
      store.moveRequest(node.collection.id, node.request.id, target.collId, target.containerId);
    } else {
      store.moveFolder(node.collection.id, node.folder.id, target.collId, target.containerId);
    }
  });

  // =====================================================================
  //  Importar
  // =====================================================================
  register('apiRequest.importFile', async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Colección JSON (Postman / Thunder Client)': ['json'] },
      openLabel: 'Importar',
    });
    if (!picked?.[0]) {
      return;
    }
    const imported = parseCollectionJson(fs.readFileSync(picked[0].fsPath, 'utf8'));
    if (!imported) {
      vscode.window.showErrorMessage('Formato no reconocido. Soporto Postman v2.1 y exportaciones de Thunder Client.');
      return;
    }
    store.addCollection(imported.name, imported.requests, imported.folders);
    const n = countImported(imported);
    vscode.window.showInformationMessage(
      `Importada "${imported.name}" con ${n.requests} petición(es) y ${n.folders} carpeta(s).`
    );
  });

  register('apiRequest.importCurl', async () => {
    let text = (await vscode.env.clipboard.readText()).trim();
    if (!/^curl\b/i.test(text)) {
      text =
        (await vscode.window.showInputBox({
          prompt: 'Pega el comando cURL',
          placeHolder: "curl -X POST 'https://api.ejemplo.com/login' -H 'Content-Type: application/json' -d '{...}'",
          ignoreFocusOut: true,
        })) || '';
    }
    if (!text) {
      return;
    }
    const req = parseCurl(text);
    if (!req) {
      vscode.window.showErrorMessage('No pude interpretar ese comando cURL.');
      return;
    }
    const target = await pickContainer(store, 'Dónde crear la petición');
    if (!target) {
      return;
    }
    const saved = store.addRequest(target.collId, req.name, req, target.containerId);
    if (saved) {
      RequestPanel.open(context, store, target.collId, saved.id);
    }
  });

  // =====================================================================
  //  Historial
  // =====================================================================
  register('apiRequest.openHistory', async (entry?: HistoryEntry) => {
    if (!entry) {
      return;
    }
    const target = await pickContainer(store, 'Guardar esta petición en…');
    if (!target) {
      return;
    }
    const saved = store.addRequest(
      target.collId,
      entry.request.name || `${entry.request.method} ${entry.request.url}`,
      entry.request,
      target.containerId
    );
    if (saved) {
      RequestPanel.open(context, store, target.collId, saved.id);
    }
  });
  register('apiRequest.clearHistory', () => store.clearHistory());

  // =====================================================================
  //  Entornos y variables
  // =====================================================================
  register('apiRequest.newEnv', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Nombre del entorno',
      placeHolder: 'local, dev, prod…',
    });
    if (name?.trim()) {
      store.createEnv(name.trim());
    }
  });

  register('apiRequest.activateEnv', (node?: EnvNode) => {
    if (node?.kind === 'env') {
      store.setActiveEnv(node.name);
    }
  });

  register('apiRequest.addEnvVar', async (node?: EnvNode) => {
    if (node?.kind !== 'env') {
      return;
    }
    const name = await vscode.window.showInputBox({ prompt: 'Nombre de la variable', placeHolder: 'baseUrl' });
    if (!name?.trim()) {
      return;
    }
    const value = await vscode.window.showInputBox({ prompt: `Valor de {{${name.trim()}}}` });
    if (value !== undefined) {
      store.setEnvVar(node.name, name.trim(), value);
    }
  });

  register('apiRequest.editEnvVar', async (node?: EnvNode) => {
    if (node?.kind !== 'var') {
      return;
    }
    const value = await vscode.window.showInputBox({
      prompt: `Valor de {{${node.name}}}`,
      value: node.value,
    });
    if (value !== undefined) {
      store.setEnvVar(node.env, node.name, value);
    }
  });

  register('apiRequest.deleteEnvVar', (node?: EnvNode) => {
    if (node?.kind === 'var') {
      store.deleteEnvVar(node.env, node.name);
    }
  });

  register('apiRequest.deleteEnv', async (node?: EnvNode) => {
    if (node?.kind !== 'env') {
      return;
    }
    const ok = await vscode.window.showWarningMessage(`¿Eliminar el entorno "${node.name}"?`, { modal: true }, 'Eliminar');
    if (ok === 'Eliminar') {
      store.deleteEnv(node.name);
    }
  });

  register('apiRequest.selectEnvironment', async () => {
    const NEW = '$(add) Nuevo entorno…';
    const NONE = '$(circle-slash) Sin entorno';
    const pick = await vscode.window.showQuickPick([...store.envNames(), NONE, NEW], {
      placeHolder: 'Selecciona el entorno activo',
    });
    if (!pick) {
      return;
    }
    if (pick === NEW) {
      await vscode.commands.executeCommand('apiRequest.newEnv');
    } else {
      store.setActiveEnv(pick === NONE ? '' : pick);
    }
  });

  // Cookies guardadas (credenciales de sesión): se listan por dominio, sin mostrar sus valores
  register('apiRequest.clearCookies', async () => {
    const jar = store.getCookieJar();
    const domains = jar.domains();
    if (!domains.length) {
      vscode.window.showInformationMessage('No hay cookies guardadas.');
      return;
    }
    const total = domains.reduce((n, d) => n + d.count, 0);
    const pick = await vscode.window.showQuickPick(
      [
        { label: `$(trash) Todas (${total})`, domain: undefined as string | undefined },
        ...domains.map((d) => ({ label: d.domain, description: `${d.count} cookie(s)`, domain: d.domain as string | undefined })),
      ],
      { placeHolder: 'Cookies guardadas: elige qué borrar' }
    );
    if (!pick) {
      return;
    }
    const removed = jar.clear(pick.domain);
    store.saveCookies();
    vscode.window.showInformationMessage(`Se borraron ${removed} cookie(s).`);
  });

  register('apiRequest.editEnvironments', async () => {
    const file = store.ensureEnvFile();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  });
}

export const DEFAULT_NAME = 'Nueva petición';

function defaultCollection(store: Store) {
  return store.getCollections()[0] ?? store.addCollection('Mis peticiones');
}

function collectIds(c: Container, into: Set<string>) {
  into.add(c.id);
  c.folders.forEach((f: Folder) => collectIds(f, into));
}

/**
 * Selector de destino: colecciones y carpetas con su ruta ("API / Auth"). Si no hay colecciones
 * pide crear una; si hay un solo destino posible, lo usa sin preguntar.
 * `containerId` queda vacío cuando el destino es la raíz de la colección.
 */
async function pickContainer(
  store: Store,
  placeHolder: string,
  excluded: Set<string> = new Set()
): Promise<{ collId: string; containerId?: string } | undefined> {
  if (store.getCollections().length === 0) {
    const name = await vscode.window.showInputBox({
      prompt: 'Aún no tienes colecciones. Nombre de la nueva colección',
      placeHolder: 'Mi API',
    });
    return name?.trim() ? { collId: store.addCollection(name.trim()).id } : undefined;
  }
  const refs = store.listContainers().filter((r) => !excluded.has(r.containerId));
  if (refs.length === 1) {
    return { collId: refs[0].collectionId, containerId: refs[0].depth ? refs[0].containerId : undefined };
  }
  const pick = await vscode.window.showQuickPick(
    refs.map((r) => ({
      label: (r.depth ? '$(folder) ' : '$(library) ') + r.label,
      ref: r,
    })),
    { placeHolder }
  );
  return pick
    ? { collId: pick.ref.collectionId, containerId: pick.ref.depth ? pick.ref.containerId : undefined }
    : undefined;
}

export function deactivate() {}
