import * as vscode from 'vscode';
import * as fs from 'fs';
import { Store } from './store';
import { CollectionsTree, EnvNode, EnvTree, HistoryTree, Node } from './tree';
import { RequestPanel } from './panel';
import { HistoryEntry } from './types';
import { parseCollectionJson, parseCurl } from './importers';

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

  context.subscriptions.push(
    vscode.window.createTreeView('apiRequest.collections', {
      treeDataProvider: new CollectionsTree(store),
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

  // Abre una petición vacía al instante (sin preguntar nada), como Thunder Client.
  // Si no hay colecciones se crea "Mis peticiones" automáticamente.
  register('apiRequest.newRequest', (node?: Node) => {
    const collId = node?.collection.id ?? defaultCollection(store).id;
    const req = store.addRequest(collId, DEFAULT_NAME);
    if (req) {
      RequestPanel.open(context, store, collId, req.id);
    }
  });

  register('apiRequest.openRequest', (collId: string, reqId: string) =>
    RequestPanel.open(context, store, collId, reqId)
  );

  register('apiRequest.rename', async (node?: Node) => {
    if (!node) {
      return;
    }
    const current = node.kind === 'collection' ? node.collection.name : node.request.name;
    const name = await vscode.window.showInputBox({ prompt: 'Nuevo nombre', value: current });
    if (!name?.trim()) {
      return;
    }
    if (node.kind === 'collection') {
      store.renameCollection(node.collection.id, name.trim());
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
    }
  });

  register('apiRequest.delete', async (node?: Node) => {
    if (!node) {
      return;
    }
    const label = node.kind === 'collection' ? node.collection.name : node.request.name;
    const ok = await vscode.window.showWarningMessage(`¿Eliminar "${label}"?`, { modal: true }, 'Eliminar');
    if (ok !== 'Eliminar') {
      return;
    }
    if (node.kind === 'collection') {
      store.deleteCollection(node.collection.id);
    } else {
      store.deleteRequest(node.collection.id, node.request.id);
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
    store.addCollection(imported.name, imported.requests);
    vscode.window.showInformationMessage(
      `Importada "${imported.name}" con ${imported.requests.length} petición(es).`
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
    const collId = await pickCollection(store);
    if (!collId) {
      return;
    }
    const saved = store.addRequest(collId, req.name, req);
    if (saved) {
      RequestPanel.open(context, store, collId, saved.id);
    }
  });

  // =====================================================================
  //  Historial
  // =====================================================================
  register('apiRequest.openHistory', async (entry?: HistoryEntry) => {
    if (!entry) {
      return;
    }
    const collId = await pickCollection(store, 'Guardar esta petición en…');
    if (!collId) {
      return;
    }
    const saved = store.addRequest(collId, entry.request.name || `${entry.request.method} ${entry.request.url}`, entry.request);
    if (saved) {
      RequestPanel.open(context, store, collId, saved.id);
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

  register('apiRequest.editEnvironments', async () => {
    const file = store.ensureEnvFile();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  });
}

export const DEFAULT_NAME = 'Nueva petición';

function defaultCollection(store: Store) {
  return store.getCollections()[0] ?? store.addCollection('Mis peticiones');
}

async function pickCollection(store: Store, placeHolder = 'Colección donde crear la petición'): Promise<string | undefined> {
  const cols = store.getCollections();
  if (cols.length === 0) {
    const name = await vscode.window.showInputBox({
      prompt: 'Aún no tienes colecciones. Nombre de la nueva colección',
      placeHolder: 'Mi API',
    });
    return name?.trim() ? store.addCollection(name.trim()).id : undefined;
  }
  if (cols.length === 1) {
    return cols[0].id;
  }
  const pick = await vscode.window.showQuickPick(
    cols.map((c) => ({ label: c.name, id: c.id })),
    { placeHolder }
  );
  return pick?.id;
}

export function deactivate() {}
