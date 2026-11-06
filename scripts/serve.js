// Servidor de pruebas: sirve la interfaz del panel en un navegador usando el MOTOR REAL (out/http.js)
// y una API de ejemplo. Requiere: npm run compile   Uso: node scripts/serve.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendRequest } = require('../out/http');
const { normalizeRequest } = require('../out/model');

const root = path.resolve(__dirname, '..');
const PORT = 5173;
const memVars = { baseUrl: `http://localhost:${PORT}` };
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const THEME = `<style>:root{--vscode-font-family:Segoe UI,sans-serif;--vscode-font-size:13px;--vscode-foreground:#ccc;
--vscode-editor-background:#1e1e1e;--vscode-input-background:#3c3c3c;--vscode-input-foreground:#ccc;--vscode-dropdown-background:#3c3c3c;
--vscode-dropdown-foreground:#f0f0f0;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#1177bb;
--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;--vscode-button-secondaryHoverBackground:#45494e;
--vscode-focusBorder:#007fd4;--vscode-panel-border:#444;--vscode-badge-background:#4d4d4d;--vscode-badge-foreground:#fff;
--vscode-editor-font-family:Consolas,monospace;--vscode-editor-font-size:13px;--vscode-textLink-foreground:#3794ff}
html{background:#1f1f1f}</style>`;

const MOCK = `<script>
window.acquireVsCodeApi=()=>({postMessage:async(m)=>{
  const reply=(x)=>setTimeout(()=>window.postMessage(x,'*'),0);
  if(m.type==='ready'){
    const q=new URLSearchParams(location.search).get('scenario')||'login';
    const base={id:'1',name:'Login',method:'POST',url:'{{baseUrl}}/api/login',description:'Inicia sesión y devuelve un token JWT.',
      headers:[{enabled:true,key:'Accept',value:'application/json'}],
      body:{type:'json',content:'{\\n  "email": "admin@demo.local",\\n  "password": "123456"\\n}',formurl:[],form:[],gqlQuery:'',gqlVars:'',file:''},
      auth:{type:'none',token:'',username:'',password:'',keyName:'',keyValue:'',keyIn:'header'},
      tests:{assertions:[{enabled:true,source:'status',key:'',op:'eq',value:'200'},{enabled:true,source:'json',key:'ok',op:'eq',value:'true'},{enabled:true,source:'time',key:'',op:'lt',value:'2000'},{enabled:true,source:'json',key:'user.rol',op:'eq',value:'cliente'}],
        setVars:[{enabled:true,source:'json.token',target:'{{authToken}}'},{enabled:true,source:'cookie.sid',target:'{{sid, global}}'}]},preRun:"console.log('hola desde pre run');"};
    const me={...base,id:'2',name:'Perfil',method:'GET',url:'{{baseUrl}}/api/me',body:{...base.body,type:'none'},
      auth:{...base.auth,type:'bearer',token:'{{authToken}}'},tests:{assertions:[{enabled:true,source:'status',key:'',op:'eq',value:'200'}],setVars:[]},preRun:''};
    reply({type:'init',env:'local',vars:{baseUrl:location.origin},request:q==='me'?me:base});
  } else if(m.type==='send'){
    const r=await fetch('/__send',{method:'POST',body:JSON.stringify(m.request)});
    const {result,vars}=await r.json(); Object.assign(window.__vars||(window.__vars={}),vars);
    reply({type:'env',env:'local',vars}); reply({type:'response',result});
  }}});
</script>`;

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(obj));
}
const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- UI ----
  if (url.pathname === '/preview') {
    let html = fs.readFileSync(path.join(root, 'media/panel.html'), 'utf8')
      .replace('%%CSP%%', '').replace(/%%NONCE%%/g, '')
      .replace('%%CSS%%', '/media/main.css').replace('%%JS%%', '/media/main.js')
      .replace('</head>', THEME + '</head>')
      .replace('<script nonce="" src="/media/main.js">', MOCK + '<script src="/media/main.js">');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }
  // ---- motor real ----
  if (url.pathname === '/__send' && req.method === 'POST') {
    const request = normalizeRequest(JSON.parse(await readBody(req)));
    const result = await sendRequest(request, {
      vars: memVars,
      options: { timeoutMs: 10000, followRedirects: true },
      setVar: (n, v) => { if (v === null) delete memVars[n]; else memVars[n] = v; },
    });
    return sendJson(res, 200, { result, vars: { ...memVars } });
  }
  // ---- API de ejemplo ----
  if (url.pathname === '/api/equipos') {
    return sendJson(res, 200, { page: 1, limit: 10, total: 2, data: [{ id: 1, nombre: 'Trek', activo: true }, { id: 2, nombre: 'Giant', activo: false }] });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    let j = {}; try { j = JSON.parse(b); } catch (_) {}
    if (j.password !== '123456') return sendJson(res, 401, { ok: false, error: 'Credenciales inválidas' });
    return sendJson(res, 200, { ok: true, user: { id_usuario: 2, nombre: 'Cliente Prueba', rol: 'cliente' }, token: 'eyJhbGciOiJIUzI1NiJ9.demo.token' },
      { 'Set-Cookie': ['sid=abc123; Path=/; HttpOnly', 'tema=oscuro; Path=/'] });
  }
  if (url.pathname === '/api/me') {
    if (req.headers.authorization !== 'Bearer eyJhbGciOiJIUzI1NiJ9.demo.token') return sendJson(res, 401, { error: 'No autorizado' });
    return sendJson(res, 200, { id: 2, nombre: 'Cliente Prueba' });
  }
  if (url.pathname === '/api/echo') {
    const b = await readBody(req);
    return sendJson(res, 200, { method: req.method, query: Object.fromEntries(url.searchParams), contentType: req.headers['content-type'] || null, auth: req.headers.authorization || null, body: b.slice(0, 500) });
  }
  // ---- estáticos ----
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no encontrado'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}/preview`));
