// Prueba de humo del arranque: simula la API de VS Code, ejecuta activate() y los comandos principales.
// Requiere: npm run compile        Uso: node scripts/smoke-activate.js
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-smoke-'));
const workspace = path.join(tmp, 'proyecto');
fs.mkdirSync(workspace);

const commands = new Map();
const panels = [];
const statusItems = [];
const messages = [];
const trees = [];

class EventEmitter {
  constructor() { this.l = []; this.event = (fn) => { this.l.push(fn); return { dispose() {} }; }; }
  fire(v) { this.l.forEach((fn) => fn(v)); }
}
const uri = (p) => ({ fsPath: p, toString: () => 'file:///' + p });

const vscode = {
  version: '1.145.1-simulado',
  env: { appName: 'Simulador', clipboard: { readText: async () => '' } },
  EventEmitter,
  DataTransferItem: class { constructor(v) { this.value = v; } async asString() { return this.value; } },
  TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Active: -1 },
  Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
  workspace: {
    workspaceFolders: [{ uri: uri(workspace) }],
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidSaveTextDocument: () => ({ dispose() {} }),
    getConfiguration: () => ({ get: (_k, d) => d }),
  },
  commands: {
    registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; },
    executeCommand: async (id, ...a) => commands.get(id)?.(...a),
  },
  window: {
    createOutputChannel: () => ({ appendLine: (l) => console.log('   [log]', l), show() {}, dispose() {} }),
    createTreeView: (id, opts) => { trees.push({ id, opts }); return { dispose() {} }; },
    createStatusBarItem: () => { const s = { show() {}, dispose() {} }; statusItems.push(s); return s; },
    _inputs: [], _picks: [], _confirm: 'Eliminar', _details: [], _warnings: [],
    showInputBox: function () { return Promise.resolve(vscode.window._inputs.shift()); },
    showQuickPick: function (items) { const want = vscode.window._picks.shift(); return Promise.resolve(typeof want === 'function' ? items.find(want) : want); },
    showWarningMessage: function (m, opts) { vscode.window._warnings.push(m); vscode.window._details.push(opts && opts.detail); return Promise.resolve(vscode.window._confirm); },
    showErrorMessage: (m) => { messages.push(m); return Promise.resolve(undefined); },
    showInformationMessage: (m) => { messages.push(m); return Promise.resolve(undefined); },
    createWebviewPanel: (type, title) => {
      const p = {
        type, title, revealed: 0, sent: [],
        reveal() { this.revealed++; }, dispose() {}, onDidDispose() {},
        webview: {
          html: '', cspSource: 'vscode-resource:', _handler: null,
          asWebviewUri: (u) => ({ toString: () => 'vscode-webview://x/' + path.basename(u.fsPath) }),
          onDidReceiveMessage(fn) { this._handler = fn; },
          postMessage(m) { p.sent.push(m); return Promise.resolve(true); },
        },
      };
      panels.push(p);
      return p;
    },
  },
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : origLoad.call(this, request, ...rest);
};

const context = {
  subscriptions: [],
  extensionUri: uri(root),
  globalStorageUri: uri(path.join(tmp, 'global')),
  globalState: { _d: {}, get(k, d) { return this._d[k] ?? d; }, async update(k, v) { this._d[k] = v; } },
  extension: { packageJSON: require(path.join(root, 'package.json')) },
};

(async () => {
  let n = 0;
  const ok = (m) => console.log('  ✓', m, `(${++n})`);
  try {
    const ext = require(path.join(root, 'out', 'extension.js'));
    ext.activate(context);
    ok('activate() terminó sin errores');
    assert.strictEqual(trees.length, 3); ok('se crearon las 3 vistas (colecciones, entornos, actividad)');
    assert.strictEqual(statusItems.length, 1); ok('se creó el indicador de la barra de estado');

    const needed = ['newCollection', 'newRequest', 'openRequest', 'rename', 'duplicate', 'delete', 'importFile', 'importCurl',
      'openHistory', 'clearHistory', 'newEnv', 'activateEnv', 'addEnvVar', 'editEnvVar', 'deleteEnvVar', 'deleteEnv',
      'selectEnvironment', 'editEnvironments', 'newFolder', 'moveTo', 'clearCookies'].map((c) => 'apiRequest.' + c);
    const missing = needed.filter((c) => !commands.has(c));
    assert.deepStrictEqual(missing, []); ok(`los ${needed.length} comandos están registrados`);

    // "Nueva petición" sin colecciones: crea "Mis peticiones" y abre el panel
    await commands.get('apiRequest.newRequest')();
    assert.strictEqual(panels.length, 1); ok('"Nueva petición" abrió un panel');
    const html = panels[0].webview.html;
    assert.ok(html.includes('id="url"') && html.includes('main.js') && html.includes("script-src 'nonce-")); ok('el HTML del panel se generó con CSP y script');
    assert.ok(html.includes('editing.js') && html.indexOf('editing.js') < html.indexOf('main.js') && !html.includes('%%')); ok('el panel carga las ayudas del editor antes que main.js y no quedan marcadores sin sustituir');
    const file = path.join(workspace, '.api-request', 'collections.json');
    const cols = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(cols[0].name, 'Mis peticiones'); assert.strictEqual(cols[0].requests[0].name, 'Nueva petición'); ok('se guardó collections.json con la petición');

    // el panel responde al mensaje "ready" con la petición
    await panels[0].webview._handler({ type: 'ready' });
    const init = panels[0].sent.find((m) => m.type === 'init');
    assert.ok(init && init.request.name === 'Nueva petición'); ok('el panel recibió "init" con la petición');

    // enviar una petición real desde el panel
    const http = require('http');
    const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); r.end('{"hola":"mundo"}'); });
    await new Promise((res) => srv.listen(0, res));
    const req = { ...init.request, url: `http://127.0.0.1:${srv.address().port}/x` };
    await panels[0].webview._handler({ type: 'send', request: req });
    srv.close();
    const resp = panels[0].sent.find((m) => m.type === 'response');
    assert.strictEqual(resp.result.status, 200); assert.strictEqual(resp.result.body, '{"hola":"mundo"}'); ok('"Enviar" devolvió la respuesta al panel');

    // aviso de secreto en texto plano al enviar (una sola vez por petición)
    const conToken = { ...init.request, url: `http://127.0.0.1:1/x`, auth: { ...init.request.auth, type: 'bearer', token: 'eyJhbGciOi.literal' } };
    vscode.window._warnings.length = 0;
    await panels[0].webview._handler({ type: 'send', request: conToken });
    assert.strictEqual(vscode.window._warnings.length, 1); assert.ok(vscode.window._warnings[0].includes('Auth: token Bearer') && vscode.window._warnings[0].includes('{{token}}')); ok('enviar con un Bearer escrito a mano avisa (sugiere usar una variable)');
    await panels[0].webview._handler({ type: 'send', request: conToken });
    assert.strictEqual(vscode.window._warnings.length, 1); ok('el aviso no se repite en cada envío de la misma petición');
    await panels[0].webview._handler({ type: 'send', request: { ...conToken, auth: { ...conToken.auth, token: '{{token}}' } } });
    assert.strictEqual(vscode.window._warnings.length, 1); ok('con una variable {{token}} no hay aviso');
    assert.ok(fs.readFileSync(path.join(workspace, '.api-request', '.gitignore'), 'utf8').includes('environments.json')); ok('el proyecto quedó con .api-request/.gitignore');

    // cookies: enviar desde el panel guarda las Set-Cookie en cookies.json (fuera de git) y las reenvía
    const srv2 = http.createServer((q, r) => {
      if (q.url === '/login') { r.setHeader('Set-Cookie', 'sid=S9; Path=/'); r.end('ok'); } else { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ cookie: q.headers.cookie || '' })); }
    });
    await new Promise((res) => srv2.listen(0, '127.0.0.1', res));
    const b2 = `http://127.0.0.1:${srv2.address().port}`;
    await panels[0].webview._handler({ type: 'send', request: { ...init.request, url: b2 + '/login', auth: { ...init.request.auth, type: 'none' } } });
    const cj = path.join(workspace, '.api-request', 'cookies.json');
    assert.ok(fs.existsSync(cj) && JSON.parse(fs.readFileSync(cj, 'utf8'))[0].name === 'sid'); ok('la cookie de la respuesta se guardó en .api-request/cookies.json');
    assert.ok(fs.readFileSync(path.join(workspace, '.api-request', '.gitignore'), 'utf8').includes('cookies.json')); ok('cookies.json está en el .gitignore del proyecto');
    await panels[0].webview._handler({ type: 'send', request: { ...init.request, url: b2 + '/eco', auth: { ...init.request.auth, type: 'none' } } });
    const eco = panels[0].sent.filter((m) => m.type === 'response').pop();
    assert.strictEqual(JSON.parse(eco.result.body).cookie, 'sid=S9'); ok('la petición siguiente envía la cookie sola');
    vscode.window._picks.push((p) => p.domain === undefined);
    await commands.get('apiRequest.clearCookies')();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(cj, 'utf8')), []); ok('"Limpiar cookies guardadas" borra todas y actualiza el archivo');
    await panels[0].webview._handler({ type: 'send', request: { ...init.request, url: b2 + '/eco', auth: { ...init.request.auth, type: 'none' } } });
    assert.strictEqual(JSON.parse(panels[0].sent.filter((m) => m.type === 'response').pop().result.body).cookie, ''); ok('tras limpiar, ya no se envía ninguna cookie');
    srv2.close();

    // segunda "Nueva petición" y entornos
    await commands.get('apiRequest.newRequest')();
    assert.strictEqual(panels.length, 2); ok('segunda "Nueva petición" abrió otro panel');
    await commands.get('apiRequest.editEnvironments')().catch(() => {});

    // ---------- carpetas: árbol, comandos y arrastrar y soltar ----------
    const win = vscode.window;
    const view = trees.find((t) => t.id === 'apiRequest.collections').opts;
    const tree = view.treeDataProvider;
    assert.strictEqual(view.dragAndDropController, tree);
    assert.deepStrictEqual(tree.dragMimeTypes, ['application/vnd.code.tree.apirequest.collections']); ok('la vista de colecciones tiene el controlador de arrastrar y soltar');
    const names = (nodes) => nodes.map((x) => x.kind + ':' + (x.folder ? x.folder.name : x.request ? x.request.name : x.collection.name));
    const coll = () => tree.getChildren()[0];
    const auth = () => tree.getChildren(coll()).find((x) => x.kind === 'folder');
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'))[0];

    win._inputs.push('Auth');
    await commands.get('apiRequest.newFolder')(coll());
    win._inputs.push('Tokens');
    await commands.get('apiRequest.newFolder')(auth());
    assert.strictEqual(auth().folder.name, 'Auth');
    assert.deepStrictEqual(names(tree.getChildren(auth())), ['folder:Tokens']); ok('"Nueva carpeta" crea una carpeta y una subcarpeta anidada');

    const kids = names(tree.getChildren(coll()));
    assert.ok(kids.indexOf('folder:Auth') < kids.findIndex((x) => x.startsWith('request:'))); ok('las carpetas se muestran antes que las peticiones');
    const item = tree.getTreeItem(auth());
    assert.strictEqual(item.contextValue, 'folder'); assert.strictEqual(item.collapsibleState, 2); ok('la carpeta es un nodo expandible con contextValue "folder"');

    const before = panels.length;
    await commands.get('apiRequest.newRequest')(auth());
    assert.strictEqual(panels.length, before + 1);
    assert.strictEqual(read().folders[0].requests.length, 1); ok('"Nueva petición" sobre una carpeta crea la petición dentro de ella');
    const inner = tree.getChildren(auth()).find((x) => x.kind === 'request');
    assert.strictEqual(tree.getParent(inner).folder.name, 'Auth');
    assert.strictEqual(tree.getParent(tree.getChildren(auth()).find((x) => x.kind === 'folder')).folder.name, 'Auth');
    assert.strictEqual(tree.getParent(auth()).kind, 'collection'); ok('getParent devuelve la carpeta o colección contenedora');

    win._inputs.push('Autenticación');
    await commands.get('apiRequest.rename')(auth());
    assert.strictEqual(read().folders[0].name, 'Autenticación'); ok('renombrar una carpeta');

    await commands.get('apiRequest.duplicate')(auth());
    assert.strictEqual(read().folders.length, 2); assert.strictEqual(read().folders[1].name, 'Autenticación (copia)');
    assert.notStrictEqual(read().folders[1].requests[0].id, read().folders[0].requests[0].id); ok('duplicar una carpeta copia su contenido con ids nuevas');

    win._picks.push((p) => p.ref.label === 'Mis peticiones');
    await commands.get('apiRequest.moveTo')(inner);
    assert.strictEqual(read().folders[0].requests.length, 0); assert.ok(read().requests.some((r) => r.id === inner.request.id)); ok('"Mover a…" lleva la petición a la raíz de la colección');

    let offered;
    const origQP = win.showQuickPick;
    win.showQuickPick = (items) => { offered = items.map((i) => i.ref.label); win.showQuickPick = origQP; return Promise.resolve(undefined); };
    await commands.get('apiRequest.moveTo')(auth());
    assert.ok(offered.includes('Mis peticiones') && !offered.some((l) => l.indexOf('Mis peticiones / Autenticación') === 0 && !l.includes('copia'))); ok('"Mover a…" excluye la carpeta y sus descendientes');

    const dt = () => { const m = new Map(); return { set: (k, v) => m.set(k, v), get: (k) => m.get(k) }; };
    const reqNode = tree.getChildren(coll()).find((x) => x.kind === 'request');
    const d1 = dt();
    tree.handleDrag([reqNode], d1);
    await tree.handleDrop(auth(), d1);
    assert.ok(read().folders[0].requests.some((r) => r.id === reqNode.request.id)); ok('arrastrar una petición sobre una carpeta la mueve dentro');

    const tokens = tree.getChildren(auth()).find((x) => x.kind === 'folder');
    const d2 = dt();
    tree.handleDrag([auth()], d2);
    await tree.handleDrop(tokens, d2);
    assert.strictEqual(read().folders[0].name, 'Autenticación'); assert.strictEqual(read().folders[0].folders[0].name, 'Tokens'); ok('no se puede soltar una carpeta dentro de su propia subcarpeta');

    await commands.get('apiRequest.newRequest')();
    const siblings = () => tree.getChildren(coll()).filter((x) => x.kind === 'request');
    const idsBefore = siblings().map((x) => x.request.id);
    assert.ok(idsBefore.length >= 2);
    const d3 = dt();
    tree.handleDrag([siblings()[siblings().length - 1]], d3);
    await tree.handleDrop(siblings()[0], d3);
    assert.strictEqual(siblings()[0].request.id, idsBefore[idsBefore.length - 1]); ok('soltar una petición sobre otra la coloca antes (reordenar)');

    const d4 = dt();
    tree.handleDrag([tree.getChildren(auth()).find((x) => x.kind === 'request')], d4);
    await tree.handleDrop(coll(), d4);
    assert.strictEqual(read().folders[0].requests.length, 0); ok('soltar sobre la colección saca la petición de su carpeta');

    win._confirm = 'Eliminar'; win._details.length = 0;
    const copia = tree.getChildren(coll()).find((x) => x.kind === 'folder' && x.folder.name === 'Autenticación (copia)');
    await commands.get('apiRequest.delete')(copia);
    assert.ok(/1 petición\(es\) y 1 carpeta\(s\)/.test(win._details[0]), String(win._details[0]));
    assert.strictEqual(read().folders.length, 1); ok('eliminar una carpeta muestra cuánto contenido se pierde y la elimina');
    win._confirm = undefined;
    await commands.get('apiRequest.delete')(auth());
    assert.strictEqual(read().folders.length, 1); ok('cancelar la confirmación no elimina nada');

    win._inputs.push('Desde selector'); win._picks.push((p) => p.ref.label === 'Mis peticiones / Autenticación');
    await commands.get('apiRequest.newFolder')();
    assert.ok(read().folders[0].folders.some((f) => f.name === 'Desde selector')); ok('"Nueva carpeta" desde la barra permite elegir el destino');

    win.showOpenDialog = async () => [uri(path.join(tmp, 'pm.json'))];
    fs.writeFileSync(path.join(tmp, 'pm.json'), JSON.stringify({ info: { name: 'PM' }, item: [{ name: 'Usuarios', item: [{ name: 'Listar', request: { method: 'GET', url: 'http://x/u' } }] }] }));
    await commands.get('apiRequest.importFile')();
    const pm = JSON.parse(fs.readFileSync(file, 'utf8')).find((c) => c.name === 'PM');
    assert.strictEqual(pm.folders[0].name, 'Usuarios'); assert.strictEqual(pm.folders[0].requests[0].name, 'Listar'); ok('importar crea la jerarquía de carpetas real');

    console.log(`\nOK: ${n} comprobaciones del arranque pasaron`);
  } catch (e) {
    console.error('\nFALLO:', e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
