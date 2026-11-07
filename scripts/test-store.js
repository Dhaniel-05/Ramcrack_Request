// Pruebas del almacén de datos (colecciones, carpetas anidadas, mover, migración desde la 0.2.x).
// No necesita VS Code: simula la API mínima que usa el almacén. Requiere: npm run compile
// Uso: node scripts/test-store.js
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
let workspace = null;

class EventEmitter {
  constructor() { this.l = []; this.event = (fn) => { this.l.push(fn); return { dispose() {} }; }; }
  fire(v) { this.l.forEach((fn) => fn(v)); }
}
const vscode = {
  EventEmitter,
  workspace: {
    get workspaceFolders() { return workspace ? [{ uri: { fsPath: workspace } }] : undefined; },
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidSaveTextDocument: () => ({ dispose() {} }),
  },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : origLoad.call(this, request, ...rest);
};

const { Store } = require(path.join(root, 'out', 'store.js'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-store-'));
let counter = 0;
function newWorkspace() {
  workspace = path.join(tmpRoot, 'p' + ++counter);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}
function makeStore() {
  return new Store({
    subscriptions: [],
    globalStorageUri: { fsPath: path.join(tmpRoot, 'global') },
    globalState: { _d: {}, get(k, d) { return this._d[k] ?? d; }, async update(k, v) { this._d[k] = v; } },
  });
}
const dataDir = () => path.join(workspace, '.api-request');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(dataDir(), f), 'utf8'));
function allIds(coll) {
  const ids = [];
  const visit = (c) => {
    ids.push(c.id);
    c.requests.forEach((r) => ids.push(r.id));
    c.folders.forEach(visit);
  };
  visit(coll);
  return ids;
}

let n = 0;
const ok = (m) => console.log('  ✓', m, `(${++n})`);

try {
  // ---------------------------------------------------------------- migración desde la 0.2.x
  newWorkspace();
  fs.mkdirSync(dataDir(), { recursive: true });
  const legacy = JSON.stringify(
    [{
      id: 'c1', name: 'Vieja', rareza: 'campo-desconocido',
      requests: [{ id: 'r1', name: 'Login', method: 'POST', url: 'http://x/login', headers: [], body: { type: 'json', content: '{}' } }],
    }],
    null, 2
  );
  fs.writeFileSync(path.join(dataDir(), 'collections.json'), legacy, 'utf8');

  let store = makeStore();
  assert.deepStrictEqual(store.getCollection('c1').folders, []); ok('colección de la 0.2.x se abre con folders = []');
  assert.ok(store.getRequest('c1', 'r1').tests && store.getRequest('c1', 'r1').auth); ok('las peticiones antiguas se completan con los campos nuevos');
  assert.strictEqual(fs.readFileSync(path.join(dataDir(), 'collections.json'), 'utf8'), legacy); ok('abrir no modifica el archivo original');
  assert.ok(!fs.existsSync(path.join(dataDir(), 'collections.backup.json'))); ok('todavía no hay copia de seguridad (no se ha guardado nada)');

  const carpetaAuth = store.addFolder('c1', 'Auth');
  assert.ok(carpetaAuth && carpetaAuth.id); ok('addFolder devuelve la carpeta creada');
  assert.strictEqual(fs.readFileSync(path.join(dataDir(), 'collections.backup.json'), 'utf8'), legacy); ok('el primer guardado crea collections.backup.json idéntico al original');
  store.addFolder('c1', 'Equipos');
  assert.strictEqual(fs.readFileSync(path.join(dataDir(), 'collections.backup.json'), 'utf8'), legacy); ok('un segundo guardado NO sobrescribe la copia de seguridad');
  const guardado = readJson('collections.json');
  assert.strictEqual(guardado[0].rareza, 'campo-desconocido'); ok('los campos desconocidos de la colección se conservan');
  assert.strictEqual(guardado[0].folders.length, 2); ok('el archivo guardado ya incluye las carpetas');

  // un archivo nuevo (sin historial) no genera copia de seguridad
  newWorkspace();
  store = makeStore();
  store.addCollection('Nueva');
  assert.ok(!fs.existsSync(path.join(dataDir(), 'collections.backup.json'))); ok('un proyecto nuevo no crea copia de seguridad');
  assert.deepStrictEqual(readJson('collections.json')[0].folders, []); ok('una colección nueva se guarda con folders: []');

  // ---------------------------------------------------------------- carpetas anidadas
  newWorkspace();
  store = makeStore();
  const col = store.addCollection('API');
  const f1 = store.addFolder(col.id, 'Auth');
  const f2 = store.addFolder(col.id, 'Login', f1.id);
  const f3 = store.addFolder(col.id, 'Tokens', f2.id);
  assert.strictEqual(store.getFolder(col.id, f3.id).name, 'Tokens'); ok('carpetas anidadas hasta 3 niveles');
  assert.strictEqual(store.addFolder(col.id, 'X', 'no-existe'), undefined); ok('addFolder con padre inexistente devuelve undefined');
  assert.strictEqual(store.addFolder('no-existe', 'X'), undefined); ok('addFolder con colección inexistente devuelve undefined');

  const req = store.addRequest(col.id, 'Entrar', undefined, f2.id);
  assert.strictEqual(store.getRequest(col.id, req.id).name, 'Entrar'); ok('una petición dentro de una carpeta se encuentra por id');
  assert.strictEqual(store.addRequest(col.id, 'X', undefined, 'no-existe'), undefined); ok('addRequest en carpeta inexistente devuelve undefined');
  const enRaiz = store.addRequest(col.id, 'Raíz');
  assert.strictEqual(col.requests.length, 1); ok('sin carpeta, la petición va a la raíz de la colección');

  store.updateRequest(col.id, { ...req, url: 'http://nuevo/login', name: 'Entrar v2' });
  const reabierto = makeStore();
  const enDisco = reabierto.getCollection(col.id).folders[0].folders[0].requests[0];
  assert.strictEqual(enDisco.url, 'http://nuevo/login'); assert.strictEqual(enDisco.name, 'Entrar v2'); ok('editar una petición anidada se guarda y se recarga desde disco');
  assert.deepStrictEqual(reabierto.getCollection(col.id).folders[0].folders[0].folders.map((f) => f.name), ['Tokens']); ok('la estructura completa sobrevive a recargar');

  // ---------------------------------------------------------------- duplicar
  const copiaReq = store.duplicateRequest(col.id, req.id);
  const lista = store.getFolder(col.id, f2.id).requests;
  assert.strictEqual(lista.length, 2); assert.strictEqual(lista[1].id, copiaReq.id); assert.ok(copiaReq.name.endsWith('(copia)')); assert.notStrictEqual(copiaReq.id, req.id); ok('duplicar una petición anidada la deja justo después, con id nueva');

  store.addRequest(col.id, 'Dentro de Tokens', undefined, f3.id);
  const antes = allIds(store.getCollection(col.id));
  const copiaCarpeta = store.duplicateFolder(col.id, f1.id);
  assert.strictEqual(copiaCarpeta.name, 'Auth (copia)'); ok('duplicar carpeta: nombre con "(copia)"');
  const idsCopia = [];
  (function v(c) { idsCopia.push(c.id); c.requests.forEach((r) => idsCopia.push(r.id)); c.folders.forEach(v); })(copiaCarpeta);
  assert.strictEqual(idsCopia.length, 6); ok('duplicar carpeta: copia profunda (3 carpetas + 3 peticiones)');
  assert.ok(idsCopia.every((id) => !antes.includes(id))); ok('duplicar carpeta: NINGUNA id se repite con el original');
  assert.strictEqual(store.getCollection(col.id).folders[1].id, copiaCarpeta.id); ok('la copia queda justo después de la original');
  const todas = allIds(store.getCollection(col.id));
  assert.strictEqual(new Set(todas).size, todas.length); ok('todas las ids de la colección son únicas');

  // ---------------------------------------------------------------- mover
  assert.strictEqual(store.moveRequest(col.id, req.id, col.id), true);
  assert.strictEqual(col.requests[col.requests.length - 1].id, req.id); ok('mover una petición a la raíz de su colección (al final)');
  assert.ok(!store.getFolder(col.id, f2.id).requests.some((r) => r.id === req.id)); ok('al mover, desaparece del origen (sin duplicarse)');
  assert.strictEqual(store.moveRequest(col.id, req.id, col.id, f1.id, 0), true);
  assert.strictEqual(store.getFolder(col.id, f1.id).requests[0].id, req.id); ok('mover una petición a una carpeta en la posición 0');
  assert.strictEqual(store.moveRequest(col.id, 'no-existe', col.id), false); ok('mover una petición inexistente devuelve false');
  assert.strictEqual(store.moveRequest(col.id, req.id, col.id, 'no-existe'), false); ok('mover a un destino inexistente devuelve false y no pierde la petición');
  assert.ok(store.getRequest(col.id, req.id)); ok('la petición sigue existiendo tras un movimiento fallido');

  // reordenar dentro de la misma lista: posición final
  const a = store.addRequest(col.id, 'A', undefined, f1.id);
  const b = store.addRequest(col.id, 'B', undefined, f1.id);
  const nombres = () => store.getFolder(col.id, f1.id).requests.map((r) => r.name);
  const base = nombres();
  store.moveRequest(col.id, b.id, col.id, f1.id, 0);
  assert.strictEqual(nombres()[0], 'B'); assert.strictEqual(nombres().length, base.length); ok('reordenar dentro de la misma carpeta (posición final)');

  // carpetas: no se puede mover a sí misma ni a un descendiente
  assert.strictEqual(store.moveFolder(col.id, f1.id, col.id, f1.id), false); ok('una carpeta no se puede mover dentro de sí misma');
  assert.strictEqual(store.moveFolder(col.id, f1.id, col.id, f3.id), false); ok('una carpeta no se puede mover dentro de una subcarpeta suya');
  assert.strictEqual(store.getCollection(col.id).folders[0].id, f1.id); ok('tras el movimiento prohibido, el árbol no cambió');
  assert.strictEqual(store.moveFolder(col.id, f3.id, col.id), true);
  assert.ok(store.getCollection(col.id).folders.some((f) => f.id === f3.id)); ok('mover una subcarpeta a la raíz de la colección');
  assert.ok(!store.getFolder(col.id, f2.id).folders.some((f) => f.id === f3.id)); ok('la subcarpeta deja de estar en su padre anterior');
  assert.strictEqual(store.moveFolder(col.id, f3.id, col.id, f1.id, 0), true);
  assert.strictEqual(store.getFolder(col.id, f1.id).folders[0].id, f3.id); ok('mover una carpeta dentro de otra, en la posición 0');

  // entre colecciones
  const otra = store.addCollection('Otra');
  const carpetaOtra = store.addFolder(otra.id, 'Destino');
  assert.strictEqual(store.moveRequest(col.id, req.id, otra.id, carpetaOtra.id), true);
  assert.strictEqual(store.getRequest(otra.id, req.id).name, 'Entrar v2'); assert.strictEqual(store.getRequest(col.id, req.id), undefined); ok('mover una petición a OTRA colección');
  assert.strictEqual(store.moveFolder(col.id, f3.id, otra.id, carpetaOtra.id), true);
  assert.strictEqual(store.getFolder(otra.id, f3.id).name, 'Tokens'); assert.strictEqual(store.getFolder(col.id, f3.id), undefined); ok('mover una carpeta a OTRA colección');

  // ---------------------------------------------------------------- listContainers
  const refs = store.listContainers();
  assert.ok(refs.some((r) => r.label === 'API') && refs.some((r) => r.label === 'API / Auth') && refs.some((r) => r.label === 'Otra / Destino / Tokens')); ok('listContainers devuelve rutas legibles ("API / Auth", "Otra / Destino / Tokens")');
  assert.strictEqual(refs.find((r) => r.label === 'Otra / Destino / Tokens').depth, 2); ok('listContainers informa la profundidad');

  // ---------------------------------------------------------------- borrar
  const idAnidada = store.getFolder(col.id, f2.id).requests[0].id;
  assert.strictEqual(store.deleteFolder(col.id, f1.id), true);
  assert.strictEqual(store.getFolder(col.id, f2.id), undefined); assert.strictEqual(store.getRequest(col.id, idAnidada), undefined); ok('borrar una carpeta elimina también sus subcarpetas y peticiones');
  assert.strictEqual(store.deleteFolder(col.id, 'no-existe'), false); ok('borrar una carpeta inexistente devuelve false');
  store.deleteRequest(otra.id, req.id);
  assert.strictEqual(store.getRequest(otra.id, req.id), undefined); ok('borrar una petición anidada');
  store.deleteCollection(otra.id);
  assert.strictEqual(store.getCollection(otra.id), undefined); ok('borrar una colección con carpetas');
  assert.strictEqual(store.renameFolder(col.id, copiaCarpeta.id, 'Renombrada'), true);
  assert.strictEqual(store.getFolder(col.id, copiaCarpeta.id).name, 'Renombrada'); ok('renombrar una carpeta');

  // todo lo anterior se guardó en disco y vuelve igual
  const final = makeStore();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(final.getCollections())), JSON.parse(JSON.stringify(store.getCollections()))); ok('el estado en disco coincide exactamente con el de memoria');

  // ---------- .gitignore automático ----------
  newWorkspace();
  const g1 = makeStore();
  g1.addCollection('Colección');
  const gi = () => fs.readFileSync(path.join(dataDir(), '.gitignore'), 'utf8');
  const lines = () => gi().split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines().includes('environments.json') && lines().includes('cookies.json') && lines().includes('collections.backup.json')); ok('al guardar se crea .api-request/.gitignore con entornos, cookies y copia de seguridad');
  assert.ok(!lines().includes('collections.json')); ok('collections.json NO se ignora (se puede versionar)');
  g1.setEnvVar('@global', 'a', '1');
  assert.strictEqual(lines().filter((l) => l === 'environments.json').length, 1); ok('guardar de nuevo no duplica las líneas');

  newWorkspace();
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), '.gitignore'), '# mío\nnotas.txt\nenvironments.json');
  const g2 = makeStore();
  g2.addCollection('X');
  assert.ok(gi().startsWith('# mío\nnotas.txt\nenvironments.json\n')); assert.ok(lines().includes('cookies.json') && lines().includes('collections.backup.json'));
  assert.strictEqual(lines().filter((l) => l === 'environments.json').length, 1); ok('un .gitignore existente se completa sin borrar ni duplicar lo del usuario (aunque no termine en salto de línea)');

  const sinWs = workspace; workspace = null;
  const g3 = makeStore();
  g3.addCollection('Global');
  assert.strictEqual(g3.inWorkspace(), false);
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'global', '.gitignore'))); workspace = sinWs; ok('sin carpeta de proyecto (almacenamiento global) no se crea ningún .gitignore');

  console.log(`\nOK: ${n} comprobaciones del almacén pasaron`);
} catch (e) {
  console.error('\nFALLO:', e);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
