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
      'selectEnvironment', 'editEnvironments'].map((c) => 'apiRequest.' + c);
    const missing = needed.filter((c) => !commands.has(c));
    assert.deepStrictEqual(missing, []); ok(`los ${needed.length} comandos están registrados`);

    // "Nueva petición" sin colecciones: crea "Mis peticiones" y abre el panel
    await commands.get('apiRequest.newRequest')();
    assert.strictEqual(panels.length, 1); ok('"Nueva petición" abrió un panel');
    const html = panels[0].webview.html;
    assert.ok(html.includes('id="url"') && html.includes('main.js') && html.includes("script-src 'nonce-")); ok('el HTML del panel se generó con CSP y script');
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

    // segunda "Nueva petición" y entornos
    await commands.get('apiRequest.newRequest')();
    assert.strictEqual(panels.length, 2); ok('segunda "Nueva petición" abrió otro panel');
    await commands.get('apiRequest.editEnvironments')().catch(() => {});

    console.log(`\nOK: ${n} comprobaciones del arranque pasaron`);
  } catch (e) {
    console.error('\nFALLO:', e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
