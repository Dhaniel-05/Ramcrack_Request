// Pruebas del almacén de cookies y de su uso en el motor (incluidas las redirecciones).
// Requiere: npm run compile        Uso: node scripts/test-cookies.js
const http = require('http');
const assert = require('assert');
const { CookieJar } = require('../out/cookiejar');
const { sendRequest } = require('../out/http');
const { normalizeRequest } = require('../out/model');

let n = 0;
const ok = (m) => console.log('  ✓', m, `(${++n})`);
const T0 = Date.parse('2026-01-01T00:00:00Z');

function unit() {
  const j = new CookieJar();
  j.store(['sid=abc; Path=/'], 'http://api.ejemplo.com/login', T0);
  assert.strictEqual(j.headerFor('http://api.ejemplo.com/x', T0), 'sid=abc'); ok('se guarda y se envía una cookie en el mismo host');
  assert.strictEqual(j.headerFor('http://otro.com/x', T0), ''); ok('no se envía a otro dominio');
  assert.strictEqual(j.headerFor('http://sub.api.ejemplo.com/x', T0), ''); ok('sin Domain, la cookie es solo del host exacto (no de sus subdominios)');

  const d = new CookieJar();
  d.store(['a=1; Domain=.ejemplo.com'], 'http://api.ejemplo.com/', T0);
  assert.strictEqual(d.headerFor('http://www.ejemplo.com/', T0), 'a=1');
  assert.strictEqual(d.headerFor('http://ejemplo.com/', T0), 'a=1');
  assert.strictEqual(d.headerFor('http://malejemplo.com/', T0), ''); ok('con Domain vale para el dominio y sus subdominios, pero no para otro que solo termina igual');

  const t = new CookieJar();
  assert.strictEqual(t.store(['robo=1; Domain=victima.com'], 'http://atacante.com/', T0), false);
  assert.strictEqual(t.headerFor('http://victima.com/', T0), ''); ok('un sitio no puede fijar cookies de un dominio ajeno');

  const p = new CookieJar();
  p.store(['x=1; Path=/admin', 'y=2; Path=/'], 'http://h.com/', T0);
  assert.strictEqual(p.headerFor('http://h.com/admin/usuarios', T0), 'x=1; y=2');
  assert.strictEqual(p.headerFor('http://h.com/administracion', T0), 'y=2');
  assert.strictEqual(p.headerFor('http://h.com/', T0), 'y=2'); ok('la ruta se respeta (/admin no coincide con /administracion) y la más específica va primero');
  const dp = new CookieJar();
  dp.store(['z=1'], 'http://h.com/api/v1/login', T0);
  assert.strictEqual(dp.headerFor('http://h.com/api/v1/otro', T0), 'z=1'); assert.strictEqual(dp.headerFor('http://h.com/otra', T0), ''); ok('sin Path, la ruta por defecto es el directorio de la petición');

  const s = new CookieJar();
  assert.strictEqual(s.store(['seg=1; Secure'], 'http://h.com/', T0), false); ok('una cookie Secure no se acepta desde http');
  s.store(['seg=1; Secure'], 'https://h.com/', T0);
  assert.strictEqual(s.headerFor('https://h.com/', T0), 'seg=1'); assert.strictEqual(s.headerFor('http://h.com/', T0), ''); ok('una cookie Secure solo se envía por https');

  const e = new CookieJar();
  e.store(['m=1; Max-Age=60', 'ex=1; Expires=Thu, 01 Jan 2026 00:10:00 GMT', 'ses=1'], 'http://h.com/', T0);
  assert.strictEqual(e.headerFor('http://h.com/', T0 + 30000), 'm=1; ex=1; ses=1');
  assert.strictEqual(e.headerFor('http://h.com/', T0 + 120000), 'ex=1; ses=1');
  assert.strictEqual(e.headerFor('http://h.com/', T0 + 11 * 60000), 'ses=1'); ok('Max-Age y Expires caducan; la cookie de sesión no');
  e.store(['m=1; Max-Age=60; Expires=Thu, 01 Jan 2030 00:00:00 GMT'], 'http://h.com/', T0);
  assert.strictEqual(e.headerFor('http://h.com/', T0 + 120000).includes('m=1'), false); ok('Max-Age manda sobre Expires');

  const del = new CookieJar();
  del.store(['sid=1'], 'http://h.com/', T0);
  assert.strictEqual(del.store(['sid=; Max-Age=0'], 'http://h.com/', T0), true);
  assert.strictEqual(del.headerFor('http://h.com/', T0), ''); ok('Max-Age=0 borra la cookie');
  del.store(['q=1'], 'http://h.com/', T0); del.store(['q=2'], 'http://h.com/', T0);
  assert.strictEqual(del.headerFor('http://h.com/', T0), 'q=2'); assert.strictEqual(del.list().length, 1); ok('el mismo nombre/dominio/ruta se sustituye');

  const i = new CookieJar();
  assert.strictEqual(i.store(['a=1; Domain=0.0.1'], 'http://127.0.0.1/', T0), false);
  i.store(['a=1'], 'http://127.0.0.1:3000/', T0);
  assert.strictEqual(i.headerFor('http://127.0.0.1:5000/', T0), 'a=1'); ok('en IP no hay subdominios; las cookies no distinguen el puerto');
  assert.strictEqual(new CookieJar().store(['sin-igual', '=vacio', 'a=1; Path=sin-barra'], 'http://h.com/', T0), true); ok('líneas mal formadas se ignoran sin romper las demás');

  const r = new CookieJar(JSON.parse(JSON.stringify(j)));
  assert.strictEqual(r.headerFor('http://api.ejemplo.com/', T0), 'sid=abc'); ok('el almacén se guarda y se recupera de JSON');
  const c = new CookieJar();
  c.store(['a=1', 'b=1'], 'http://uno.com/', T0); c.store(['c=1'], 'http://dos.com/', T0);
  assert.deepStrictEqual(c.domains(), [{ domain: 'dos.com', count: 1 }, { domain: 'uno.com', count: 2 }]);
  assert.strictEqual(c.clear('uno.com'), 2); assert.strictEqual(c.list().length, 1); assert.strictEqual(c.clear(), 1); ok('domains() y clear() por dominio / todas');
}

async function engine() {
  const seen = [];
  const hits = { loop: 0 };
  const srv = http.createServer((req, res) => {
    const url = req.url;
    seen.push({ url, cookie: req.headers.cookie || '', auth: req.headers.authorization || '', method: req.method });
    const send = (code, headers = {}, body = '') => { res.writeHead(code, headers); res.end(body); };
    if (url === '/login') return send(200, { 'Set-Cookie': ['sid=S1; Path=/; HttpOnly', 'tema=oscuro; Path=/'] }, 'ok');
    if (url === '/me') return send(req.headers.cookie && req.headers.cookie.includes('sid=S1') ? 200 : 401, {}, 'me');
    if (url === '/start') return send(302, { Location: '/paso2', 'Set-Cookie': 'saltoA=1; Path=/' });
    if (url === '/paso2') return send(302, { Location: '/final', 'Set-Cookie': 'saltoB=2; Path=/' });
    if (url === '/final') return send(200, {}, 'final');
    if (url === '/post303') return send(303, { Location: '/final' });
    if (url === '/post307') return send(307, { Location: '/final' });
    if (url === '/bucle') { hits.loop++; return send(302, { Location: '/bucle' }); }
    send(404);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const otro = `http://localhost:${srv.address().port}`;
  const mk = (p) => normalizeRequest({ id: 'x', name: 'x', method: 'GET', ...p });
  const ctx = (jar, follow = true) => ({ vars: {}, options: { timeoutMs: 5000, followRedirects: follow }, setVar() {}, cookieJar: jar });
  try {
    const sin = await sendRequest(mk({ url: base + '/me' }), ctx(undefined));
    assert.strictEqual(sin.status, 401); ok('sin cookies la ruta protegida da 401');

    const jar = new CookieJar();
    let r = await sendRequest(mk({ url: base + '/login' }), ctx(jar));
    assert.strictEqual(r.status, 200); assert.strictEqual(jar.list().length, 2);
    assert.ok(r.cookies.some((c) => c.name === 'sid')); ok('el login guarda sus Set-Cookie y la respuesta sigue mostrándolos');
    r = await sendRequest(mk({ url: base + '/me' }), ctx(jar));
    assert.strictEqual(r.status, 200); ok('la petición siguiente envía la cookie sola y entra (200)');

    r = await sendRequest(mk({ url: otro + '/me' }), ctx(jar));
    assert.strictEqual(r.status, 401); assert.strictEqual(seen[seen.length - 1].cookie, ''); ok('el mismo servidor por otro host (localhost) no recibe la cookie');

    r = await sendRequest(mk({ url: base + '/me', headers: [{ enabled: true, key: 'Cookie', value: 'sid=otra' }] }), ctx(jar));
    assert.strictEqual(r.status, 401); assert.strictEqual(seen[seen.length - 1].cookie, 'sid=otra'); ok('un header Cookie escrito a mano tiene prioridad sobre el almacén');

    const j2 = new CookieJar();
    seen.length = 0;
    r = await sendRequest(mk({ url: base + '/start' }), ctx(j2));
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body, 'final');
    assert.deepStrictEqual(seen.map((s) => s.url), ['/start', '/paso2', '/final']);
    assert.strictEqual(seen[1].cookie, 'saltoA=1'); assert.strictEqual(seen[2].cookie, 'saltoA=1; saltoB=2'); ok('redirecciones: las cookies de cada salto se guardan y viajan en los siguientes');

    const j3 = new CookieJar();
    r = await sendRequest(mk({ url: base + '/start' }), ctx(j3, false));
    assert.strictEqual(r.status, 302); assert.strictEqual(j3.list().length, 1); ok('con "no seguir redirecciones" se devuelve el 302 y se guarda su cookie');

    seen.length = 0;
    r = await sendRequest(mk({ method: 'POST', url: base + '/post303', headers: [{ enabled: true, key: 'Authorization', value: 'Bearer T' }], body: { type: 'json', content: '{"a":1}' } }), ctx(new CookieJar()));
    assert.strictEqual(r.status, 200); assert.strictEqual(seen[1].method, 'GET'); ok('un 303 después de POST se sigue como GET');
    seen.length = 0;
    await sendRequest(mk({ method: 'POST', url: base + '/post307', body: { type: 'json', content: '{"a":1}' } }), ctx(new CookieJar()));
    assert.strictEqual(seen[1].method, 'POST'); ok('un 307 conserva el método POST');

    r = await sendRequest(mk({ url: base + '/bucle' }), ctx(new CookieJar()));
    assert.ok(r.error && /redirecciones/i.test(r.error)); assert.strictEqual(hits.loop, 11); ok('un bucle de redirecciones se corta a los 10 saltos con un error claro');

    seen.length = 0;
    r = await sendRequest(mk({ url: base + '/start' }), ctx(undefined));
    assert.strictEqual(r.body, 'final'); assert.strictEqual(seen[2].cookie, ''); ok('sin almacén todo funciona como antes (redirección nativa, sin cookies)');
  } finally {
    srv.close();
  }
}

(async () => {
  try {
    unit();
    await engine();
    console.log(`\nOK: ${n} comprobaciones de cookies pasaron`);
  } catch (e) {
    console.error('\nFALLO:', e);
    process.exitCode = 1;
  }
})();
