// Pruebas del motor (sin VS Code) contra un servidor local. Requiere: npm run compile
const http = require('http');
const assert = require('assert');
const { sendRequest } = require('../out/http');
const { substitute, systemVar } = require('../out/vars');
const { parseCurl, parseCollectionJson } = require('../out/importers');
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
    r = await sendRequest(mk({ method: 'POST', url: base, body: { type: 'graphql', gqlQuery: '{a}', gqlVars: '{mal' } }), ctx());
    assert.ok(r.error); ok('graphql con variables inválidas -> error claro');

    // tests + set env var + cookies + pre run
    r = await sendRequest(mk({
      url: base,
      preRun: "tc.setVar('pre', 'listo'); console.log('log', 1)",
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
    assert.strictEqual(store['a:lit'], 'literal'); assert.strictEqual(store['a:pre'], 'listo'); ok('Set Env Variable + tc.setVar');
    assert.ok(r.varMessages.some((m) => m.startsWith('✗'))); ok('mensaje cuando no existe el origen');
    assert.deepStrictEqual(r.logs, ['log 1']); assert.strictEqual(r.cookies[0].name, 'sid'); ok('logs + cookies');

    // errores
    r = await sendRequest(mk({ url: 'http://127.0.0.1:1' }), ctx());
    assert.ok(r.error); ok('error de conexión');
    r = await sendRequest(mk({ url: base, preRun: 'while(true){}' }), ctx());
    assert.match(r.error, /Pre Run/); ok('Pre Run infinito se corta por timeout');

    // importadores
    const c = parseCurl(`curl -X POST 'https://api.x.com/login?a=1' \\\n  -H 'Content-Type: application/json' \\\n  -H "Authorization: Bearer abc" \\\n  -d '{"u":"a"}'`);
    assert.strictEqual(c.method, 'POST'); assert.strictEqual(c.body.type, 'json'); assert.strictEqual(c.headers.length, 2); ok('cURL multilínea');
    const c2 = parseCurl("curl https://x.com -u user:pass -F 'f=@/tmp/a.png' -F 'n=1'");
    assert.strictEqual(c2.auth.type, 'basic'); assert.strictEqual(c2.body.form[0].type, 'file'); ok('cURL -u y -F');
    const pm = parseCollectionJson(JSON.stringify({ info: { name: 'Demo' }, item: [{ name: 'Carpeta', item: [{ name: 'Get', request: { method: 'GET', url: { raw: 'http://x/a' }, header: [{ key: 'A', value: '1' }], auth: { type: 'bearer', bearer: [{ key: 'token', value: 'T' }] } } }] }] }));
    assert.strictEqual(pm.requests[0].name, 'Carpeta / Get'); assert.strictEqual(pm.requests[0].auth.token, 'T'); ok('importar Postman v2.1');
    const tc = parseCollectionJson(JSON.stringify({ collectionName: 'TC', folders: [{ _id: 'f1', name: 'Auth' }], requests: [{ name: 'Login', method: 'POST', url: 'http://x/l', containerId: 'f1', body: { type: 'json', raw: '{}' }, auth: { type: 'bearer', bearer: 'zz' } }] }));
    assert.strictEqual(tc.requests[0].name, 'Auth / Login'); assert.strictEqual(tc.requests[0].body.type, 'json'); ok('importar Thunder Client');
    const old = normalizeRequest({ name: 'v0', method: 'POST', url: 'x', body: { type: 'form', content: 'a=1\nb=2' } });
    assert.strictEqual(old.body.type, 'formurl'); assert.strictEqual(old.body.formurl.length, 2); ok('migración de datos de la versión 0.0.x');

    console.log(`\nOK: ${n} comprobaciones pasaron`);
  } catch (e) {
    console.error('\nFALLO:', e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
