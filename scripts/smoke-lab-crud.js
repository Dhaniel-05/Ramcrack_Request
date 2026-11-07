// Prueba de humo del MOTOR de la extensión contra una API REAL (el "laboratorio CRUD" de ejemplo):
// login, token con "Guardar en variable", permisos por rol, CRUD de equipos, subida / reemplazo /
// borrado de imágenes y casos límite. Usa out/http.js, así que primero: npm run compile
//
// ⚠ ESCRIBE EN LA BASE DE DATOS de esa API: crea registros "ZZ_PRUEBA_*" (los borra al final) y, si
//   defines las credenciales del cliente, registra ese usuario (no se puede borrar). Por eso pide
//   confirmación explícita. No se guarda ninguna contraseña en este archivo: se leen del entorno.
//
// Uso (PowerShell):
//   $env:RR_ADMIN_EMAIL = "admin@ejemplo.local"; $env:RR_ADMIN_PASSWORD = "<clave del admin>"
//   $env:RR_CLIENT_EMAIL = "cliente@ejemplo.local"; $env:RR_CLIENT_PASSWORD = "<clave del cliente>"   # opcional
//   $env:RR_UPLOADS_DIR = "D:\ruta\backend\uploads\equipos"   # opcional: activa las comprobaciones de disco
//   $env:RR_BASE_URL = "http://localhost:3000"                 # opcional (valor por defecto)
//   node scripts/smoke-lab-crud.js --yes
//
// Sin RR_CLIENT_*: se omiten las pruebas del rol cliente. Sin RR_UPLOADS_DIR: se omiten las de disco.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sendRequest } = require('../out/http.js');
const { normalizeRequest } = require('../out/model.js');

const env = process.env;
const BASE = (env.RR_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_EMAIL = env.RR_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = env.RR_ADMIN_PASSWORD || '';
const CLIENT_EMAIL = env.RR_CLIENT_EMAIL || '';
const CLIENT_PASSWORD = env.RR_CLIENT_PASSWORD || '';
const UPLOADS = env.RR_UPLOADS_DIR || '';
const CONFIRMADO = process.argv.includes('--yes') || env.RR_CONFIRM === 'SI';
const HAY_CLIENTE = Boolean(CLIENT_EMAIL && CLIENT_PASSWORD);

if (process.argv.includes('--help') || !ADMIN_EMAIL || !ADMIN_PASSWORD || !CONFIRMADO) {
  console.log('Prueba de humo contra una API real (ESCRIBE en su base de datos).\n');
  console.log('Faltan datos. Define como mínimo:');
  console.log('  RR_ADMIN_EMAIL y RR_ADMIN_PASSWORD   credenciales de un administrador de esa API');
  console.log('  --yes (o RR_CONFIRM=SI)              confirmas que aceptas que escriba en la base de datos');
  console.log('Opcionales: RR_CLIENT_EMAIL, RR_CLIENT_PASSWORD, RR_UPLOADS_DIR, RR_BASE_URL (ver el encabezado del archivo).');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}

const vars = { baseUrl: BASE };
const ctx = { vars, options: { timeoutMs: 15000, followRedirects: true }, setVar: (n, v) => { if (v === null) delete vars[n]; else vars[n] = v; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-smoke-'));
const png1 = path.join(tmp, 'uno.png');    fs.writeFileSync(png1, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const png2 = path.join(tmp, 'dos.png');    fs.writeFileSync(png2, Buffer.concat([fs.readFileSync(png1), Buffer.from('-segunda')]));
const jpg = path.join(tmp, 'foto.jpg');    fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]));
const webp = path.join(tmp, 'img.webp');   fs.writeFileSync(webp, Buffer.from('RIFF....WEBPVP8 ', 'latin1'));
const txt = path.join(tmp, 'nota.txt');    fs.writeFileSync(txt, 'no es una imagen');
const big = path.join(tmp, 'grande.png');  fs.writeFileSync(big, Buffer.alloc(2.5 * 1024 * 1024, 1));

const A = (source, op, value = '', key = '') => ({ enabled: true, source, key, op, value });
const bearer = (t) => ({ type: 'bearer', token: t });
const json = (o) => ({ type: 'json', content: JSON.stringify(o) });
const files = () => (UPLOADS ? fs.readdirSync(UPLOADS).filter((f) => f !== '.gitkeep') : []);

const cuenta = { ok: 0, fallo: 0, hallazgos: 0 };
const fallos = [];
const hallazgos = [];

/** hallazgo = true: si falla, se cuenta como hallazgo de la API (⚠) y no como fallo de la extensión. */
async function run(name, partial, { hallazgo = false } = {}) {
  const req = normalizeRequest({ id: name, name, method: 'GET', url: '', ...partial });
  const res = await sendRequest(req, ctx);
  const malos = res.error ? [{ name: 'ERROR ' + res.error, detail: '' }] : res.tests.filter((t) => !t.pass);
  const malosVars = res.varMessages.filter((m) => m.startsWith('✗'));
  const total = res.tests.length;
  const bad = malos.length + malosVars.length;
  console.log(`${bad ? (hallazgo ? '⚠' : '✗') : '✓'} ${name.padEnd(58)} ${String(res.status || '-').padEnd(4)} ${String(res.timeMs).padStart(4)} ms  ${total - malos.length}/${total}`);
  if (bad) {
    [...malos.map((t) => `${t.name} [${t.detail}]`), ...malosVars].forEach((t) => {
      console.log(`     ${hallazgo ? '⚠' : '✗'} ${t}`);
      (hallazgo ? hallazgos : fallos).push(`${name}: ${t}`);
    });
    if (hallazgo) { cuenta.hallazgos += bad; console.log(`     respuesta: ${String(res.body).slice(0, 110).replace(/\s+/g, ' ')}`); } else cuenta.fallo += bad;
  }
  cuenta.ok += total - malos.length;
  return res;
}
function check(name, cond, detalle = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : '  [' + detalle + ']'}`);
  if (cond) cuenta.ok++; else { cuenta.fallo++; fallos.push(`${name} ${detalle}`); }
}

(async () => {
  const sub = String(Date.now());
  const archivosAntes = files();
  console.log(`=== Prueba de humo contra ${BASE} (motor de Ramcrack Request) ===\n`);

  await run('01 Health', { url: '{{baseUrl}}/api/health', tests: { assertions: [A('status', 'eq', '200')] } });
  const login = await run('02 Login admin + guardar token', {
    method: 'POST', url: '{{baseUrl}}/api/auth/login', body: json({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    tests: { assertions: [A('status', 'eq', '200'), A('json', 'eq', 'admin', 'user.rol')], setVars: [{ enabled: true, source: 'json.token', target: '{{token}}' }] },
  });
  if (login.status !== 200) { console.log('\nNo se pudo iniciar sesión como administrador. Se detiene la prueba.'); process.exitCode = 2; return; }
  await run('03 Total inicial', { url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), tests: { assertions: [A('status', 'eq', '200')], setVars: [{ enabled: true, source: 'json.data.length', target: '{{totalAntes}}' }] } });
  await run('04 Sin token → 401', { url: '{{baseUrl}}/api/equipos', tests: { assertions: [A('status', 'eq', '401')] } });
  await run('05 Token inválido → 401', { url: '{{baseUrl}}/api/equipos', auth: bearer('abc.def.ghi'), tests: { assertions: [A('status', 'eq', '401')] } });

  if (HAY_CLIENTE) {
    console.log('\n--- Rol cliente');
    await run('06 Registro: faltan campos → 400', { method: 'POST', url: '{{baseUrl}}/api/auth/register', body: json({ nombre: 'Solo nombre' }), tests: { assertions: [A('status', 'eq', '400')] } });
    const reg = await run('07 Registro del cliente (intenta colar rol "admin")', { method: 'POST', url: '{{baseUrl}}/api/auth/register', body: json({ nombre: 'Cliente Prueba', email: CLIENT_EMAIL, password: CLIENT_PASSWORD, rol: 'admin' }) });
    check('   el registro creó al usuario (201) o ya existía (409)', [201, 409].includes(reg.status), 'respondió ' + reg.status);
    await run('08 Login cliente: el rol NO es admin', { method: 'POST', url: '{{baseUrl}}/api/auth/login', body: json({ email: CLIENT_EMAIL, password: CLIENT_PASSWORD }), tests: { assertions: [A('status', 'eq', '200'), A('json', 'eq', 'cliente', 'user.rol')], setVars: [{ enabled: true, source: 'json.token', target: '{{tokenCliente}}' }] } });
    await run('09 Cliente crea equipo → 201', { method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{tokenCliente}}'), preRun: `rr.setVar('sufijo', '${sub}')`, body: json({ nombre: 'ZZ_PRUEBA_CLI_{{sufijo}}' }), tests: { assertions: [A('status', 'eq', '201')], setVars: [{ enabled: true, source: 'json.data.id_equipo', target: '{{idCli}}' }] } });
    await run('10 Cliente NO puede borrar → 403', { method: 'DELETE', url: '{{baseUrl}}/api/equipos/{{idCli}}', auth: bearer('{{tokenCliente}}'), tests: { assertions: [A('status', 'eq', '403'), A('json', 'eq', 'false', 'ok')] } });
    await run('11 Admin sí puede borrarlo → 200', { method: 'DELETE', url: '{{baseUrl}}/api/equipos/{{idCli}}', auth: bearer('{{token}}'), tests: { assertions: [A('status', 'eq', '200')] } });
  } else {
    console.log('\n(sin RR_CLIENT_EMAIL / RR_CLIENT_PASSWORD: se omiten las pruebas del rol cliente)');
  }

  console.log('\n--- CRUD con JSON y variables');
  await run('12 Crear (JSON, pre-ejecución rr + variables de sistema)', {
    method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), preRun: `rr.setVar('sufijo', '${sub}')`,
    body: json({ nombre: 'ZZ_PRUEBA_{{sufijo}}', marca: '{{#enum, Logitech, HP, Dell}}', modelo: 'M-{{#number, 100, 999}}' }),
    tests: { assertions: [A('status', 'eq', '201'), A('json', 'contains', 'ZZ_PRUEBA_', 'data.nombre'), A('json', 'regex', '^M-\\d{3}$', 'data.modelo')], setVars: [{ enabled: true, source: 'json.data.id_equipo', target: '{{idJson}}' }] },
  });
  await run('13 Obtener por id', { url: '{{baseUrl}}/api/equipos/{{idJson}}', auth: bearer('{{token}}'), tests: { assertions: [A('status', 'eq', '200'), A('json', 'eq', '{{idJson}}', 'data.id_equipo')] } });
  await run('14 Actualizar (PUT JSON)', { method: 'PUT', url: '{{baseUrl}}/api/equipos/{{idJson}}', auth: bearer('{{token}}'), body: json({ nombre: 'ZZ_PRUEBA_{{sufijo}}_editado', marca: 'Editada' }), tests: { assertions: [A('status', 'eq', '200')] } });
  await run('15 Confirmar la edición', { url: '{{baseUrl}}/api/equipos/{{idJson}}', auth: bearer('{{token}}'), tests: { assertions: [A('json', 'contains', '_editado', 'data.nombre'), A('json', 'eq', 'Editada', 'data.marca')] } });
  await run('16 Query en la URL no rompe el listado', { url: '{{baseUrl}}/api/equipos?x=1&y=dos', auth: bearer('{{token}}'), tests: { assertions: [A('status', 'eq', '200')] } });

  console.log('\n--- Imágenes: subir, reemplazar, servir y borrar');
  await run('17 Crear con imagen PNG (multipart) → 201', {
    method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'),
    body: { type: 'form', form: [{ enabled: true, key: 'nombre', type: 'text', value: 'ZZ_PRUEBA_IMG_{{sufijo}}' }, { enabled: true, key: 'imagen', type: 'file', value: png1 }] },
    tests: { assertions: [A('status', 'eq', '201'), A('json', 'exists', '', 'data.imagen')], setVars: [{ enabled: true, source: 'json.data.id_equipo', target: '{{idImg}}' }, { enabled: true, source: 'json.data.imagen', target: '{{imgA}}' }] },
  });
  if (UPLOADS) check('   el archivo A existe en el disco del servidor', fs.existsSync(path.join(UPLOADS, vars.imgA || 'no')), String(vars.imgA));
  await run('18 La imagen se sirve → 200 image/png', { url: '{{baseUrl}}/uploads/equipos/{{imgA}}', tests: { assertions: [A('status', 'eq', '200'), A('header', 'eq', 'image/png', 'content-type')] } });
  await run('19 Reemplazar imagen (PUT multipart con otro PNG) → 200', { method: 'PUT', url: '{{baseUrl}}/api/equipos/{{idImg}}', auth: bearer('{{token}}'), body: { type: 'form', form: [{ enabled: true, key: 'nombre', type: 'text', value: 'ZZ_PRUEBA_IMG_{{sufijo}}_v2' }, { enabled: true, key: 'imagen', type: 'file', value: png2 }] }, tests: { assertions: [A('status', 'eq', '200')] } });
  await run('20 GET: la imagen cambió', { url: '{{baseUrl}}/api/equipos/{{idImg}}', auth: bearer('{{token}}'), tests: { assertions: [A('status', 'eq', '200')], setVars: [{ enabled: true, source: 'json.data.imagen', target: '{{imgB}}' }] } });
  check('   la imagen B es distinta de la A', Boolean(vars.imgB) && vars.imgB !== vars.imgA, `A=${vars.imgA} B=${vars.imgB}`);
  if (UPLOADS) { check('   el servidor borró la imagen A al reemplazarla', !fs.existsSync(path.join(UPLOADS, vars.imgA)), 'sigue en disco'); check('   la imagen B está en disco', fs.existsSync(path.join(UPLOADS, vars.imgB))); }
  await run('21 Aceptan .jpg → 201', { method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), body: { type: 'form', form: [{ enabled: true, key: 'nombre', type: 'text', value: 'ZZ_PRUEBA_JPG' }, { enabled: true, key: 'imagen', type: 'file', value: jpg }] }, tests: { assertions: [A('status', 'eq', '201')], setVars: [{ enabled: true, source: 'json.data.id_equipo', target: '{{idJpg}}' }] } });
  await run('22 Aceptan .webp → 201', { method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), body: { type: 'form', form: [{ enabled: true, key: 'nombre', type: 'text', value: 'ZZ_PRUEBA_WEBP' }, { enabled: true, key: 'imagen', type: 'file', value: webp }] }, tests: { assertions: [A('status', 'eq', '201')], setVars: [{ enabled: true, source: 'json.data.id_equipo', target: '{{idWebp}}' }] } });
  await run('23 Rechazan .txt → 400', { method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), body: { type: 'form', form: [{ enabled: true, key: 'nombre', type: 'text', value: 'ZZ_PRUEBA_TXT' }, { enabled: true, key: 'imagen', type: 'file', value: txt }] }, tests: { assertions: [A('status', 'eq', '400')] } });

  console.log('\n--- Casos límite (lo ideal es 4xx; un 500 se marca ⚠ como hallazgo de la API, no de la extensión)');
  await run('24 Archivo mayor que el límite → 4xx', { method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), body: { type: 'form', form: [{ enabled: true, key: 'nombre', type: 'text', value: 'ZZ_PRUEBA_GRANDE' }, { enabled: true, key: 'imagen', type: 'file', value: big }] }, tests: { assertions: [A('status', 'lt', '500')] } }, { hallazgo: true });
  await run('25 JSON mal formado → 4xx', { method: 'POST', url: '{{baseUrl}}/api/auth/login', body: { type: 'json', content: '{"email": mal' }, tests: { assertions: [A('status', 'lt', '500')] } }, { hallazgo: true });
  await run('26 POST sin cuerpo → 4xx', { method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), tests: { assertions: [A('status', 'lt', '500')] } }, { hallazgo: true });
  await run('27 form-urlencoded → no es 500', { method: 'POST', url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), body: { type: 'formurl', formurl: [{ enabled: true, key: 'nombre', value: 'ZZ_PRUEBA_URL' }] }, tests: { assertions: [A('status', 'lt', '500')], setVars: [{ enabled: true, source: 'json.data.id_equipo', target: '{{idUrl}}' }] } }, { hallazgo: true });
  await run('28 PUT sin nombre → 4xx', { method: 'PUT', url: '{{baseUrl}}/api/equipos/{{idJson}}', auth: bearer('{{token}}'), body: json({ marca: 'solo marca' }), tests: { assertions: [A('status', 'lt', '500')] } }, { hallazgo: true });
  await run('29 Id inexistente → 404', { url: '{{baseUrl}}/api/equipos/99999999', auth: bearer('{{token}}'), tests: { assertions: [A('status', 'eq', '404')] } });
  await run('30 Ruta inexistente → 404', { url: '{{baseUrl}}/api/nada', tests: { assertions: [A('status', 'eq', '404')] } });

  console.log('\n--- Limpieza (solo los registros de esta prueba)');
  for (const id of ['idJson', 'idImg', 'idJpg', 'idWebp', 'idUrl']) {
    if (vars[id]) await run(`31 Borrar ${id} (admin)`, { method: 'DELETE', url: `{{baseUrl}}/api/equipos/{{${id}}}`, auth: bearer('{{token}}'), tests: { assertions: [A('status', 'eq', '200')] } });
  }
  await run('32 Estado final: mismo total que al empezar', { url: '{{baseUrl}}/api/equipos', auth: bearer('{{token}}'), tests: { assertions: [A('json', 'eq', '{{totalAntes}}', 'data.length')] } });
  if (UPLOADS) check('   el disco del servidor quedó como al empezar', JSON.stringify(archivosAntes.sort()) === JSON.stringify(files().sort()), 'quedaron archivos de prueba');

  console.log(`\n=== Resumen: ${cuenta.ok} correctas · ${cuenta.fallo} fallidas · ${cuenta.hallazgos} hallazgos de la API (⚠) ===`);
  if (fallos.length) { console.log('FALLOS (extensión o prueba):'); fallos.forEach((f) => console.log(' ✗', f)); process.exitCode = 1; }
  if (hallazgos.length) { console.log('HALLAZGOS de la API:'); hallazgos.forEach((f) => console.log(' ⚠', f)); }
})()
  .catch((e) => { console.error('ERROR inesperado', e); process.exitCode = 1; })
  .finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
