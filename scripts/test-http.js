// Pruebas del motor (sin VS Code) contra un servidor local. Requiere: npm run compile
const http = require('http');
const assert = require('assert');
const { sendRequest, mimeFromPath } = require('../out/http');
const { substitute, systemVar } = require('../out/vars');
const { parseCurl, parseCollectionJson, countImported } = require('../out/importers');
const { findPlainSecrets, isLiteral } = require('../out/secrets');
const { normalizeRequest } = require('../out/model');
const { getByPath } = require('../out/tests');

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', ['sid=xyz; Path=/']);
    res.end(JSON.stringify({
      method: req.method, url: req.url, auth: req.headers.authorization || null,
      key: req.headers['x-api-key'] || null, ct: req.headers['content-type'] || null,
      body: Buffer.concat(chunks).toString('latin1'), token: 'tok-123', items: [{ id: 1 }, { id: 2 }],
    }));
  });
});

const mk = (o) => normalizeRequest({ id: '1', name: 't', method: 'GET', url: '', ...o });
const store = {};
const ctx = (vars = {}) => ({
  vars, options: { timeoutMs: 5000, followRedirects: true },
  setVar: (n, v, s) => { store[(s === 'global' ? 'g:' : 'a:') + n] = v; },
});

server.listen(0, async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  let n = 0;
  const ok = (name) => console.log('  ✓', name, `(${++n})`);
  try {
    // variables
    assert.strictEqual(substitute('{{a}}/x/{{b}}', { a: 'A' }), 'A/x/{{b}}'); ok('substitute');
    assert.match(systemVar('#guid'), /^[0-9a-f-]{36}$/); ok('#guid');
    const num = Number(systemVar('#number, 100, 999')); assert.ok(num >= 100 && num <= 999); ok('#number min,max');
    assert.ok(['red', 'green'].includes(systemVar("#enum, red, green"))); ok('#enum');
    assert.match(systemVar("#date, 'YYYY-MM-DD'"), /^\d{4}-\d{2}-\d{2}$/); ok('#date formato');
    assert.match(substitute('{{#email}}', {}), /@example\.com$/); ok('#email en substitute');
    assert.strictEqual(getByPath({ a: { b: [{ c: 5 }] } }, 'json.a.b[0].c'), 5); ok('getByPath');

    // GET + variables + query apikey
    let r = await sendRequest(mk({ url: '{{base}}/hola?x=1', auth: { type: 'apikey', keyName: 'k', keyValue: 'v', keyIn: 'query' } }), ctx({ base }));
    assert.strictEqual(JSON.parse(r.body).url, '/hola?x=1&k=v'); ok('apikey en query');

    // bearer + json + apikey header
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'json', content: '{"a":1}' }, auth: { type: 'bearer', token: 'tok' } }), ctx());
    let j = JSON.parse(r.body);
    assert.strictEqual(j.auth, 'Bearer tok'); assert.strictEqual(j.body, '{"a":1}'); assert.strictEqual(j.ct, 'application/json'); ok('bearer + json');
    r = await sendRequest(mk({ url: base, auth: { type: 'apikey', keyName: 'X-API-Key', keyValue: 'abc', keyIn: 'header' } }), ctx());
    assert.strictEqual(JSON.parse(r.body).key, 'abc'); ok('apikey en header');
    r = await sendRequest(mk({ url: base, auth: { type: 'basic', username: 'u', password: 'p' } }), ctx());
    assert.strictEqual(JSON.parse(r.body).auth, 'Basic ' + Buffer.from('u:p').toString('base64')); ok('basic');

    // tipos de body
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'formurl', formurl: [{ enabled: true, key: 'a', value: 'b c' }] } }), ctx());
    j = JSON.parse(r.body); assert.strictEqual(j.body, 'a=b+c'); assert.match(j.ct, /x-www-form-urlencoded/); ok('form-urlencoded');
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'form', form: [{ enabled: true, key: 'campo', type: 'text', value: 'valor' }] } }), ctx());
    j = JSON.parse(r.body); assert.match(j.ct, /^multipart\/form-data; boundary=/); assert.ok(j.body.includes('name="campo"')); ok('multipart');
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'graphql', gqlQuery: '{ a }', gqlVars: '{"id":1}' } }), ctx());
    assert.deepStrictEqual(JSON.parse(JSON.parse(r.body).body), { query: '{ a }', variables: { id: 1 } }); ok('graphql');
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'xml', content: '<a/>' } }), ctx());
    assert.strictEqual(JSON.parse(r.body).ct, 'application/xml'); ok('xml');
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'binary', file: __filename } }), ctx());
    assert.ok(JSON.parse(r.body).body.includes('Pruebas del motor')); ok('binary');

    // tipo de contenido de los archivos (multipart y binario): se deduce de la extensión
    assert.strictEqual(mimeFromPath('C:\\fotos\\Logo.PNG'), 'image/png');
    assert.strictEqual(mimeFromPath('/tmp/a.jpg'), 'image/jpeg');
    assert.strictEqual(mimeFromPath('x.webp'), 'image/webp');
    assert.strictEqual(mimeFromPath('doc.pdf'), 'application/pdf');
    assert.strictEqual(mimeFromPath('raro.zzz'), 'application/octet-stream');
    assert.strictEqual(mimeFromPath('sinextension'), 'application/octet-stream'); ok('mimeFromPath: png, jpg, webp, pdf, desconocido y sin extensión');

    const fsx = require('fs'); const osx = require('os'); const pathx = require('path');
    const dirx = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'rr-mime-'));
    const archivoPng = pathx.join(dirx, 'foto.png'); fsx.writeFileSync(archivoPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const archivoRaro = pathx.join(dirx, 'datos.zzz'); fsx.writeFileSync(archivoRaro, 'hola');
    const archivoPdf = pathx.join(dirx, 'informe.pdf'); fsx.writeFileSync(archivoPdf, '%PDF-1.4');
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'form', form: [{ enabled: true, key: 'imagen', type: 'file', value: archivoPng }] } }), ctx());
    j = JSON.parse(r.body);
    assert.ok(j.body.includes('filename="foto.png"')); assert.ok(j.body.includes('Content-Type: image/png')); ok('multipart: el archivo .png viaja como image/png (antes salía sin tipo y APIs como la del laboratorio lo rechazaban)');
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'form', form: [{ enabled: true, key: 'f', type: 'file', value: archivoRaro }] } }), ctx());
    assert.ok(JSON.parse(r.body).body.includes('Content-Type: application/octet-stream')); ok('multipart: extensión desconocida → application/octet-stream');
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'binary', file: archivoPdf } }), ctx());
    assert.strictEqual(JSON.parse(r.body).ct, 'application/pdf'); ok('body binario: el tipo se deduce de la extensión (.pdf)');
    r = await sendRequest(mk({ method: 'POST', url: base, headers: [{ enabled: true, key: 'Content-Type', value: 'text/x-propio' }], body: { type: 'binary', file: archivoPdf } }), ctx());
    assert.strictEqual(JSON.parse(r.body).ct, 'text/x-propio'); ok('body binario: un Content-Type escrito por el usuario tiene prioridad');
    fsx.rmSync(dirx, { recursive: true, force: true });
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'graphql', gqlQuery: '{a}', gqlVars: '{mal' } }), ctx());
    assert.ok(r.error); ok('graphql con variables inválidas -> error claro');

    // tests + set env var + cookies + pre run
    r = await sendRequest(mk({
      url: base,
      preRun: "rr.setVar('pre', 'listo'); console.log('log', 1)",
      tests: {
        assertions: [
          { enabled: true, source: 'status', key: '', op: 'eq', value: '200' },
          { enabled: true, source: 'json', key: 'items.length', op: 'eq', value: '2' },
          { enabled: true, source: 'json', key: 'items[1].id', op: 'gte', value: '2' },
          { enabled: true, source: 'header', key: 'content-type', op: 'contains', value: 'json' },
          { enabled: true, source: 'json', key: 'nada', op: 'notexists', value: '' },
          { enabled: true, source: 'body', key: '', op: 'regex', value: 'tok-\\d+' },
          { enabled: true, source: 'status', key: '', op: 'eq', value: '500' },
        ],
        setVars: [
          { enabled: true, source: 'json.token', target: '{{tk}}' },
          { enabled: true, source: 'cookie.sid', target: '{{sid, global}}' },
          { enabled: true, source: 'json.noexiste', target: '{{x}}' },
          { enabled: true, source: 'literal', target: '{{lit}}' },
        ],
      },
    }), ctx());
    assert.deepStrictEqual(r.tests.map((t) => t.pass), [true, true, true, true, true, true, false]); ok('aserciones (6 ok, 1 falla a propósito)');
    assert.strictEqual(store['a:tk'], 'tok-123'); assert.strictEqual(store['g:sid'], 'xyz');
    assert.strictEqual(store['a:lit'], 'literal'); assert.strictEqual(store['a:pre'], 'listo'); ok('Guardar en variable + rr.setVar');
    assert.ok(r.varMessages.some((m) => m.startsWith('✗'))); ok('mensaje cuando no existe el origen');
    assert.ok(r.varMessages.some((m) => m.includes('{{tk}}') && m.endsWith('(entorno activo)'))); ok('sin dato del entorno, el mensaje conserva "entorno activo"');
    const conSetVar = (activeEnv) => mk({ url: base, tests: { assertions: [], setVars: [{ enabled: true, source: 'literal', target: '{{zz}}' }, { enabled: true, source: 'literal', target: '{{gg, global}}' }] } });
    const rg = await sendRequest(conSetVar(), { ...ctx(), activeEnv: '' });
    assert.ok(rg.varMessages[0].endsWith('(global)')); assert.ok(rg.varMessages[1].endsWith('(global)')); ok('sin entorno activo, lo guardado se informa como "global" (no "entorno activo")');
    const rd = await sendRequest(conSetVar(), { ...ctx(), activeEnv: 'dev' });
    assert.ok(rd.varMessages[0].endsWith('(entorno "dev")')); assert.ok(rd.varMessages[1].endsWith('(global)')); ok('con entorno activo se nombra el entorno ("dev") y el ámbito global se mantiene');
    assert.deepStrictEqual(r.logs, ['log 1']); assert.strictEqual(r.cookies[0].name, 'sid'); ok('logs + cookies');

    // errores
    r = await sendRequest(mk({ url: 'http://127.0.0.1:1' }), ctx());
    assert.ok(r.error); ok('error de conexión');
    r = await sendRequest(mk({ url: base, preRun: 'while(true){}' }), ctx());
    assert.match(r.error, /pre-ejecución/); ok('una pre-ejecución infinita se corta por timeout');
    r = await sendRequest(mk({ url: base, preRun: "tc.setVar('viejo', 'ok'); console.log(typeof rr, typeof tc)" }), ctx());
    assert.strictEqual(store['a:viejo'], 'ok'); assert.deepStrictEqual(r.logs, ['object object']); ok('el alias antiguo tc.* sigue funcionando junto a rr.*');
    r = await sendRequest(mk({ url: base, preRun: "rr.setVar('g', 'v', 'global'); rr.setVar('leido', rr.getVar('g'))" }), ctx());
    assert.strictEqual(store['g:g'], 'v'); assert.strictEqual(store['a:leido'], 'v'); ok('rr.getVar y el ámbito global en la pre-ejecución');

    // importadores
    const c = parseCurl(`curl -X POST 'https://api.x.com/login?a=1' \\\n  -H 'Content-Type: application/json' \\\n  -H "Authorization: Bearer abc" \\\n  -d '{"u":"a"}'`);
    assert.strictEqual(c.method, 'POST'); assert.strictEqual(c.body.type, 'json'); assert.strictEqual(c.headers.length, 2); ok('cURL multilínea');
    const c2 = parseCurl("curl https://x.com -u user:pass -F 'f=@/tmp/a.png' -F 'n=1'");
    assert.strictEqual(c2.auth.type, 'basic'); assert.strictEqual(c2.body.form[0].type, 'file'); ok('cURL -u y -F');
    const pm = parseCollectionJson(JSON.stringify({ info: { name: 'Demo' }, item: [{ name: 'Carpeta', item: [{ name: 'Get', request: { method: 'GET', url: { raw: 'http://x/a' }, header: [{ key: 'A', value: '1' }], auth: { type: 'bearer', bearer: [{ key: 'token', value: 'T' }] } } }] }] }));
    assert.strictEqual(pm.requests.length, 0); assert.strictEqual(pm.folders[0].name, 'Carpeta'); assert.strictEqual(pm.folders[0].requests[0].name, 'Get'); assert.strictEqual(pm.folders[0].requests[0].auth.token, 'T'); ok('importar Postman v2.1 (carpeta real, nombre sin prefijo)');
    const pm2 = parseCollectionJson(JSON.stringify({ info: { name: 'P' }, item: [{ name: 'Raíz', request: { method: 'GET', url: 'http://x/r' } }, { name: 'A', item: [{ name: 'B', item: [{ name: 'Hondo', request: { method: 'DELETE', url: 'http://x/h' } }] }, { name: 'Vacía', item: [] }] }] }));
    assert.strictEqual(pm2.requests[0].name, 'Raíz'); assert.strictEqual(pm2.folders[0].folders[0].name, 'B'); assert.strictEqual(pm2.folders[0].folders[0].requests[0].method, 'DELETE'); assert.strictEqual(pm2.folders[0].folders[1].requests.length, 0); assert.deepStrictEqual(countImported(pm2), { requests: 2, folders: 3 }); ok('Postman con carpetas anidadas, peticiones en la raíz y carpeta vacía');
    const tc = parseCollectionJson(JSON.stringify({ collectionName: 'TC', folders: [{ _id: 'f1', name: 'Auth' }], requests: [{ name: 'Login', method: 'POST', url: 'http://x/l', containerId: 'f1', body: { type: 'json', raw: '{}' }, auth: { type: 'bearer', bearer: 'zz' } }] }));
    assert.strictEqual(tc.folders[0].name, 'Auth'); assert.strictEqual(tc.folders[0].requests[0].name, 'Login'); assert.strictEqual(tc.folders[0].requests[0].body.type, 'json'); ok('importar Thunder Client (carpeta real)');
    const tc2 = parseCollectionJson(JSON.stringify({ collectionName: 'T2', folders: [{ _id: 'h', name: 'Hija', containerId: 'p' }, { _id: 'p', name: 'Padre', containerId: '' }, { _id: 'x', name: 'CicloX', containerId: 'y' }, { _id: 'y', name: 'CicloY', containerId: 'x' }], requests: [{ name: 'Suelta', method: 'GET', url: 'http://x/s' }, { name: 'En hija', method: 'GET', url: 'http://x/h', containerId: 'h' }, { name: 'Huérfana', method: 'GET', url: 'http://x/o', containerId: 'no-existe' }] }));
    const padre = tc2.folders.find((f) => f.name === 'Padre');
    assert.strictEqual(padre.folders[0].name, 'Hija'); assert.strictEqual(padre.folders[0].requests[0].name, 'En hija'); assert.deepStrictEqual(tc2.requests.map((r) => r.name).sort(), ['Huérfana', 'Suelta']); assert.ok(tc2.folders.some((f) => f.name === 'CicloX') || tc2.folders.some((f) => f.name === 'CicloY')); ok('Thunder con carpetas anidadas (containerId), peticiones huérfanas a la raíz y ciclos tolerados');
    const old = normalizeRequest({ name: 'v0', method: 'POST', url: 'x', body: { type: 'form', content: 'a=1\nb=2' } });
    assert.strictEqual(old.body.type, 'formurl'); assert.strictEqual(old.body.formurl.length, 2); ok('migración de datos de la versión 0.0.x');

    // ---------- avisos de secretos en texto plano ----------
    const sec = (p) => findPlainSecrets(mk(p));
    assert.deepStrictEqual(sec({ auth: { type: 'bearer', token: 'abc.def' } }), ['Auth: token Bearer']);
    assert.deepStrictEqual(sec({ auth: { type: 'bearer', token: '{{token}}' } }), []);
    assert.deepStrictEqual(sec({ auth: { type: 'bearer', token: '' } }), []);
    assert.deepStrictEqual(sec({ auth: { type: 'bearer', token: ' {{a}}{{b}} ' } }), []); ok('Bearer: un valor literal avisa; una variable o vacío no');
    assert.deepStrictEqual(sec({ auth: { type: 'basic', username: 'u', password: 'p' } }), ['Auth: contraseña Basic']);
    assert.deepStrictEqual(sec({ auth: { type: 'apikey', keyName: 'X-Key', keyValue: 'k', keyIn: 'header' } }), ['Auth: API key "X-Key"']); ok('Basic y API key literales avisan');
    assert.deepStrictEqual(sec({ headers: [{ enabled: true, key: 'Authorization', value: 'Bearer zzz' }, { enabled: true, key: 'X-Otro', value: 'a' }] }), ['Headers: Authorization']);
    assert.deepStrictEqual(sec({ headers: [{ enabled: false, key: 'Authorization', value: 'Bearer zzz' }] }), []); ok('Headers: solo los campos sensibles y activos');
    assert.deepStrictEqual(sec({ body: { type: 'json', content: '{"email":"a@b.c","password":"Clave1","token":"{{t}}","apiKey":"k1"}' } }).sort(), ['Body JSON: apiKey', 'Body JSON: password']); ok('JSON: avisa por password/apiKey literales y no por {{variables}} ni por campos normales');
    assert.deepStrictEqual(sec({ body: { type: 'formurl', formurl: [{ enabled: true, key: 'password', value: 'x' }, { enabled: true, key: 'user', value: 'y' }] } }), ['Body: password']);
    assert.deepStrictEqual(sec({ body: { type: 'form', form: [{ enabled: true, key: 'token', type: 'file', value: 'C:/a.png' }] } }), []); ok('formularios: se avisa por texto sensible, no por archivos');
    assert.strictEqual(isLiteral('{{a}}'), false); assert.strictEqual(isLiteral('x{{a}}'), true); ok('isLiteral distingue variables puras de valores mezclados');

    console.log(`\nOK: ${n} comprobaciones pasaron`);
  } catch (e) {
    console.error('\nFALLO:', e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
