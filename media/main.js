(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let req = null;
  let vars = {};
  let saveTimer = null;
  let lastResponse = null;
  let parsedJson; // undefined = la respuesta no es JSON

  // pequeño helper para crear elementos
  function h(tag, props, ...children) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    children.forEach((c) => e.append(c));
    return e;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // =====================================================================
  //  Pestañas
  // =====================================================================
  document.querySelectorAll('.tabs').forEach((tabs) => {
    const group = tabs.dataset.group;
    tabs.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        document
          .querySelectorAll(`.pane[data-group="${group}"]`)
          .forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== btn.dataset.tab));
      });
    });
  });
  function showTab(group, tab) {
    const btn = document.querySelector(`.tabs[data-group="${group}"] .tab[data-tab="${tab}"]`);
    if (btn) btn.click();
  }

  // =====================================================================
  //  Pills -> input hidden
  // =====================================================================
  function setPill(targetId, value) {
    $(targetId).value = value;
    document
      .querySelectorAll(`.pills[data-target="${targetId}"] .pill-btn`)
      .forEach((b) => b.classList.toggle('active', b.dataset.value === value));
  }
  document.querySelectorAll('.pills').forEach((group) => {
    group.querySelectorAll('.pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setPill(group.dataset.target, btn.dataset.value);
        if (group.dataset.target === 'respView') updateRespView();
        else onChange();
      });
    });
  });

  // =====================================================================
  //  Filas dinámicas
  // =====================================================================
  const checkbox = (checked, cb) => {
    const c = h('input', { type: 'checkbox', checked: checked !== false });
    c.addEventListener('change', cb);
    return c;
  };
  const text = (value, placeholder, cb, list) => {
    const i = h('input', { type: 'text', value: value || '', placeholder, spellcheck: false });
    if (list) i.setAttribute('list', list);
    i.addEventListener('input', cb);
    return i;
  };
  const delBtn = (row, cb) => {
    const b = h('button', { className: 'secondary small', textContent: '✕', title: 'Quitar' });
    b.addEventListener('click', () => {
      row.remove();
      cb();
    });
    return b;
  };
  function select(options, value, cb, className) {
    const s = h('select', { className: className || '' });
    options.forEach(([v, label]) => s.append(h('option', { value: v, textContent: label })));
    s.value = value;
    s.addEventListener('change', cb);
    return s;
  }

  // ---- clave/valor genérico (headers, query, form-encode) ----
  function kvRow(item, cb, list) {
    const row = h('div', { className: 'kv' });
    row.append(checkbox(item.enabled, cb), text(item.key, 'Nombre', cb, list), text(item.value, 'Valor', cb));
    row.append(delBtn(row, cb));
    return row;
  }
  const readKV = (id) =>
    Array.from($(id).querySelectorAll(':scope > .kv')).map((row) => {
      const t = row.querySelectorAll('input[type=text]');
      return { enabled: row.querySelector('input[type=checkbox]').checked, key: t[0].value, value: t[1].value };
    });
  const renderKV = (id, items, cb, list) => {
    $(id).innerHTML = '';
    items.forEach((it) => $(id).append(kvRow(it, cb, list)));
  };

  // ---- multipart form (texto / archivo) ----
  function formRow(item) {
    const row = h('div', { className: 'kv' });
    const key = text(item.key, 'Nombre', onChange);
    const type = select([['text', 'Texto'], ['file', 'Archivo']], item.type || 'text', () => {
      sync();
      onChange();
    }, 'tiny');
    const value = text(item.value, '', onChange);
    const pick = h('button', { className: 'secondary small', textContent: 'Elegir…' });
    pick.addEventListener('click', () => {
      const idx = Array.from($('formFields').children).indexOf(row);
      vscode.postMessage({ type: 'pickFile', target: 'form', index: idx });
    });
    function sync() {
      const isFile = type.value === 'file';
      value.placeholder = isFile ? 'Ruta del archivo' : 'Valor';
      pick.classList.toggle('hidden', !isFile);
    }
    sync();
    row.append(checkbox(item.enabled, onChange), key, type, value, pick, delBtn(row, onChange));
    return row;
  }
  const readForm = () =>
    Array.from($('formFields').children).map((row) => {
      const t = row.querySelectorAll('input[type=text]');
      return {
        enabled: row.querySelector('input[type=checkbox]').checked,
        key: t[0].value,
        type: row.querySelector('select').value,
        value: t[1].value,
      };
    });
  const renderForm = (items) => {
    $('formFields').innerHTML = '';
    items.forEach((it) => $('formFields').append(formRow(it)));
  };

  // ---- aserciones ----
  const SOURCES = [['status', 'Status code'], ['time', 'Tiempo (ms)'], ['header', 'Header'], ['json', 'JSON'], ['body', 'Body']];
  const OPS = [['eq', '='], ['neq', '≠'], ['contains', 'contiene'], ['notcontains', 'no contiene'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['exists', 'existe'], ['notexists', 'no existe'], ['regex', 'regex']];
  function assertionRow(a) {
    const row = h('div', { className: 'kv' });
    const src = select(SOURCES, a.source || 'status', () => {
      sync();
      onChange();
    }, 'tiny');
    const key = text(a.key, 'ej: data.id', onChange);
    const op = select(OPS, a.op || 'eq', () => {
      sync();
      onChange();
    }, 'tiny');
    const val = text(a.value, 'Valor esperado', onChange);
    function sync() {
      key.classList.toggle('hidden', !['header', 'json'].includes(src.value));
      key.placeholder = src.value === 'header' ? 'Nombre del header' : 'ej: data.id';
      val.classList.toggle('hidden', ['exists', 'notexists'].includes(op.value));
    }
    sync();
    row.append(checkbox(a.enabled, onChange), src, key, op, val, delBtn(row, onChange));
    return row;
  }
  const readAssertions = () =>
    Array.from($('assertions').children).map((row) => {
      const sel = row.querySelectorAll('select');
      const t = row.querySelectorAll('input[type=text]');
      return { enabled: row.querySelector('input[type=checkbox]').checked, source: sel[0].value, key: t[0].value, op: sel[1].value, value: t[1].value };
    });

  // ---- Set Env Variable ----
  function setVarRow(s) {
    const row = h('div', { className: 'kv' });
    row.append(
      checkbox(s.enabled, onChange),
      text(s.source, 'json.token', onChange),
      h('span', { className: 'arrow', textContent: '→' }),
      text(s.target, '{{variable}}', onChange)
    );
    row.append(delBtn(row, onChange));
    return row;
  }
  const readSetVars = () =>
    Array.from($('setvars').children).map((row) => {
      const t = row.querySelectorAll('input[type=text]');
      return { enabled: row.querySelector('input[type=checkbox]').checked, source: t[0].value, target: t[1].value };
    });

  // =====================================================================
  //  Query <-> URL
  // =====================================================================
  const dec = (s) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch (_) {
      return s;
    }
  };
  const enc = (s) => encodeURIComponent(s).replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}');
  function splitUrl(u) {
    const hi = u.indexOf('#');
    const hash = hi >= 0 ? u.slice(hi) : '';
    const noHash = hi >= 0 ? u.slice(0, hi) : u;
    const q = noHash.indexOf('?');
    return { base: q >= 0 ? noHash.slice(0, q) : noHash, query: q >= 0 ? noHash.slice(q + 1) : '', hash };
  }
  function parseQuery(q) {
    return q.split('&').filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return { enabled: true, key: dec(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : dec(p.slice(i + 1)) };
    });
  }
  function onUrlInput() {
    const disabled = readKV('params').filter((p) => !p.enabled);
    renderKV('params', parseQuery(splitUrl($('url').value).query).concat(disabled), onParamsChange);
    onChange();
  }
  function onParamsChange() {
    const parts = splitUrl($('url').value);
    const qs = readKV('params')
      .filter((p) => p.enabled && p.key.trim())
      .map((p) => enc(p.key) + (p.value !== '' ? '=' + enc(p.value) : ''))
      .join('&');
    $('url').value = parts.base + (qs ? '?' + qs : '') + parts.hash;
    onChange();
  }

  // =====================================================================
  //  Estado <-> UI
  // =====================================================================
  const STD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'PROPFIND'];

  function currentMethod() {
    if ($('method').value === 'CUSTOM') return ($('customMethod').value.trim() || 'GET').toUpperCase();
    return $('method').value;
  }

  function readUI() {
    req.name = $('name').value;
    req.method = currentMethod();
    req.url = $('url').value;
    req.description = $('description').value;
    req.headers = readKV('headers');
    req.body = {
      type: $('bodyType').value,
      content: $('bodyContent').value,
      formurl: readKV('formurl'),
      form: readForm(),
      gqlQuery: $('gqlQuery').value,
      gqlVars: $('gqlVars').value,
      file: $('binaryPath').value,
    };
    req.auth = {
      type: $('authType').value,
      token: $('authToken').value,
      username: $('authUser').value,
      password: $('authPass').value,
      keyName: $('keyName').value,
      keyValue: $('keyValue').value,
      keyIn: $('keyIn').value,
    };
    req.tests = { assertions: readAssertions(), setVars: readSetVars() };
    req.preRun = $('preRun').value;
    return req;
  }

  function loadUI() {
    $('name').value = req.name;
    if (STD_METHODS.includes(req.method)) {
      $('method').value = req.method;
    } else {
      $('method').value = 'CUSTOM';
      $('customMethod').value = req.method;
    }
    $('url').value = req.url;
    $('description').value = req.description || '';
    renderKV('headers', req.headers, onChange, 'hdrNames');
    renderKV('params', parseQuery(splitUrl(req.url).query), onParamsChange);
    setPill('bodyType', req.body.type);
    $('bodyContent').value = req.body.content || '';
    renderKV('formurl', req.body.formurl || [], onChange);
    renderForm(req.body.form || []);
    $('gqlQuery').value = req.body.gqlQuery || '';
    $('gqlVars').value = req.body.gqlVars || '';
    $('binaryPath').value = req.body.file || '';
    setPill('authType', req.auth.type);
    $('authToken').value = req.auth.token || '';
    $('authUser').value = req.auth.username || '';
    $('authPass').value = req.auth.password || '';
    $('keyName').value = req.auth.keyName || '';
    $('keyValue').value = req.auth.keyValue || '';
    $('keyIn').value = req.auth.keyIn || 'header';
    $('assertions').innerHTML = '';
    req.tests.assertions.forEach((a) => $('assertions').append(assertionRow(a)));
    $('setvars').innerHTML = '';
    req.tests.setVars.forEach((s) => $('setvars').append(setVarRow(s)));
    $('preRun').value = req.preRun || '';
    updateVisibility();
    renderBodyHl();
    updateBadges();
    updateSnippet();
    setPill('respView', 'json');
  }

  function updateVisibility() {
    $('customMethod').classList.toggle('hidden', $('method').value !== 'CUSTOM');
    const a = $('authType').value;
    $('authNone').classList.toggle('hidden', a !== 'none');
    $('authBearer').classList.toggle('hidden', a !== 'bearer');
    $('authBasic').classList.toggle('hidden', a !== 'basic');
    $('authKey').classList.toggle('hidden', a !== 'apikey');
    const b = $('bodyType').value;
    $('bodyNone').classList.toggle('hidden', b !== 'none');
    $('bodyText').classList.toggle('hidden', !['json', 'xml', 'text'].includes(b));
    $('bodyFormurl').classList.toggle('hidden', b !== 'formurl');
    $('bodyForm').classList.toggle('hidden', b !== 'form');
    $('bodyGql').classList.toggle('hidden', b !== 'graphql');
    $('bodyBinary').classList.toggle('hidden', b !== 'binary');
    $('formatJson').classList.toggle('hidden', b !== 'json');
    $('bodyTitle').textContent = { json: 'Contenido JSON', xml: 'Contenido XML', text: 'Texto plano' }[b] || 'Contenido';
    $('bodyContent').placeholder = b === 'xml' ? '<usuario><nombre>Ramcrack</nombre></usuario>' : b === 'text' ? 'Texto…' : '{ "nombre": "Ramcrack" }';
  }

  function setCount(id, n, bad) {
    const el = $(id);
    el.textContent = n ? String(n) : '';
    el.classList.toggle('bad', !!bad);
  }
  function updateBadges() {
    const r = readUI();
    setCount('cnt-query', readKV('params').filter((p) => p.enabled && p.key.trim()).length);
    setCount('cnt-headers', r.headers.filter((x) => x.enabled && x.key.trim()).length);
    setCount('cnt-auth', r.auth.type !== 'none' ? 1 : 0);
    setCount('cnt-body', r.body.type !== 'none' ? 1 : 0);
    setCount('cnt-tests', r.tests.assertions.filter((x) => x.enabled).length + r.tests.setVars.filter((x) => x.enabled && x.source.trim()).length);
    setCount('cnt-prerun', r.preRun.trim() ? 1 : 0);
  }

  // ---- colores en el body (JSON / XML) ----
  function highlightXml(src) {
    return esc(src)
      .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="j-key">$2</span>')
      .replace(/(&quot;[^&\n]*?&quot;)/g, '<span class="j-str">$1</span>');
  }
  function renderBodyHl() {
    const t = $('bodyType').value;
    const v = $('bodyContent').value;
    const html = t === 'json' ? highlightJson(v) : t === 'xml' ? highlightXml(v) : esc(v);
    $('bodyHl').innerHTML = html + '\n';
    $('bodyHl').scrollTop = $('bodyContent').scrollTop;
  }
  $('bodyContent').addEventListener('scroll', () => {
    $('bodyHl').scrollTop = $('bodyContent').scrollTop;
    $('bodyHl').scrollLeft = $('bodyContent').scrollLeft;
  });

  function onChange() {
    renderBodyHl();
    updateVisibility();
    updateBadges();
    updateSnippet();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => vscode.postMessage({ type: 'save', request: readUI() }), 500);
  }
  const saveNow = () => {
    clearTimeout(saveTimer);
    vscode.postMessage({ type: 'save', request: readUI() });
  };

  // =====================================================================
  //  Eventos
  // =====================================================================
  ['name', 'method', 'customMethod', 'bodyContent', 'gqlQuery', 'gqlVars', 'binaryPath', 'authToken', 'authUser', 'authPass', 'keyName', 'keyValue', 'keyIn', 'preRun', 'description'].forEach((id) =>
    $(id).addEventListener('input', onChange)
  );
  $('method').addEventListener('change', onChange);
  $('keyIn').addEventListener('change', onChange);
  $('url').addEventListener('input', onUrlInput);
  $('addHeader').addEventListener('click', () => $('headers').append(kvRow({ enabled: true, key: '', value: '' }, onChange, 'hdrNames')));
  $('addParam').addEventListener('click', () => $('params').append(kvRow({ enabled: true, key: '', value: '' }, onParamsChange)));
  $('addFormurl').addEventListener('click', () => $('formurl').append(kvRow({ enabled: true, key: '', value: '' }, onChange)));
  $('addFormField').addEventListener('click', () => $('formFields').append(formRow({ enabled: true, key: '', type: 'text', value: '' })));
  $('addAssertion').addEventListener('click', () => {
    $('assertions').append(assertionRow({ enabled: true, source: 'status', key: '', op: 'eq', value: '200' }));
    onChange();
  });
  $('addSetVar').addEventListener('click', () => $('setvars').append(setVarRow({ enabled: true, source: 'json.token', target: '{{token}}' })));
  $('pickBinary').addEventListener('click', () => vscode.postMessage({ type: 'pickFile', target: 'binary', index: 0 }));
  $('save').addEventListener('click', saveNow);
  $('formatJson').addEventListener('click', () => {
    try {
      $('bodyContent').value = JSON.stringify(JSON.parse($('bodyContent').value), null, 2);
      onChange();
    } catch (e) {
      setStatus('<span class="err"><b>JSON inválido:</b> ' + esc(e.message) + '</span>');
    }
  });

  function send() {
    // Si la petición aún se llama "Nueva petición", se nombra sola con el método y la ruta
    if ($('name').value.trim() === 'Nueva petición' && $('url').value.trim()) {
      let path = $('url').value.trim();
      try {
        path = new URL(sub($('url').value.trim()).replace(/^(?![a-z]+:\/\/)/i, 'http://')).pathname;
      } catch (_) {
        path = path.replace(/^\{\{[^}]*\}\}/, '').split('?')[0] || path;
      }
      // solo la ruta: el título de la pestaña ya antepone el método
      $('name').value = path === '/' ? '/' : path.replace(/\/$/, '');
    }
    $('send').disabled = true;
    $('send').textContent = 'Enviando…';
    setStatus('<span class="busy">Enviando petición…</span>');
    vscode.postMessage({ type: 'send', request: readUI() });
  }
  $('send').addEventListener('click', send);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveNow();
    }
  });

  // splitter
  $('splitter').addEventListener('mousedown', (e) => {
    const main = document.querySelector('.main');
    const left = document.querySelector('.col.left');
    const move = (ev) => {
      const r = main.getBoundingClientRect();
      const pct = Math.min(80, Math.max(25, ((ev.clientX - r.left) / r.width) * 100));
      left.style.flex = '0 0 ' + pct + '%';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });

  // =====================================================================
  //  Snippets
  // =====================================================================
  const sub = (s) =>
    String(s == null ? '' : s).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m
    );

  function snippetData() {
    const r = readUI();
    let url = sub(r.url).trim();
    if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;
    const headers = {};
    r.headers.forEach((x) => {
      if (x.enabled && x.key.trim()) headers[sub(x.key.trim())] = sub(x.value);
    });
    const has = (n) => Object.keys(headers).some((k) => k.toLowerCase() === n);
    const a = r.auth;
    if (a.type === 'bearer' && a.token && !has('authorization')) headers['Authorization'] = 'Bearer ' + sub(a.token);
    if (a.type === 'basic' && !has('authorization')) headers['Authorization'] = 'Basic ' + btoa(sub(a.username) + ':' + sub(a.password));
    if (a.type === 'apikey' && a.keyName.trim()) {
      if (a.keyIn === 'query') url += (url.includes('?') ? '&' : '?') + encodeURIComponent(sub(a.keyName)) + '=' + encodeURIComponent(sub(a.keyValue));
      else headers[sub(a.keyName.trim())] = sub(a.keyValue);
    }
    // body normalizado: {kind:'none'|'raw'|'form'|'file', raw, fields:[{k,v,file}]}
    let body = { kind: 'none' };
    const b = r.body;
    if (b.type !== 'none' && !['GET', 'HEAD'].includes(r.method)) {
      if (['json', 'xml', 'text'].includes(b.type)) {
        body = { kind: 'raw', raw: sub(b.content) };
        const ct = { json: 'application/json', xml: 'application/xml', text: 'text/plain' }[b.type];
        if (!has('content-type')) headers['Content-Type'] = ct;
      } else if (b.type === 'formurl') {
        const p = b.formurl.filter((f) => f.enabled && f.key.trim()).map((f) => encodeURIComponent(sub(f.key.trim())) + '=' + encodeURIComponent(sub(f.value)));
        body = { kind: 'raw', raw: p.join('&') };
        if (!has('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (b.type === 'graphql') {
        let variables = {};
        try { variables = JSON.parse(sub(b.gqlVars) || '{}'); } catch (_) { /* se ignora en el snippet */ }
        body = { kind: 'raw', raw: JSON.stringify({ query: sub(b.gqlQuery), variables }) };
        if (!has('content-type')) headers['Content-Type'] = 'application/json';
      } else if (b.type === 'form') {
        body = { kind: 'form', fields: b.form.filter((f) => f.enabled && f.key.trim()).map((f) => ({ k: sub(f.key.trim()), v: sub(f.value), file: f.type === 'file' })) };
      } else if (b.type === 'binary') {
        body = { kind: 'file', raw: sub(b.file) };
      }
    }
    return { method: r.method, url, headers, body };
  }

  function genSnippet(lang) {
    const d = snippetData();
    if (!d.url) return '// Escribe una URL para ver el snippet';
    const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
    const hs = Object.entries(d.headers);
    const hBlock = (indent) => hs.map(([k, v]) => `${indent}${q(k)}: ${q(v)}`).join(',\n');

    if (lang === 'curl') {
      const sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
      let out = `curl -X ${d.method} ${sq(d.url)}`;
      hs.forEach(([k, v]) => (out += ` \\\n  -H ${sq(k + ': ' + v)}`));
      if (d.body.kind === 'raw' && d.body.raw) out += ` \\\n  --data-raw ${sq(d.body.raw)}`;
      if (d.body.kind === 'form') d.body.fields.forEach((f) => (out += ` \\\n  -F ${sq(f.k + '=' + (f.file ? '@' : '') + f.v)}`));
      if (d.body.kind === 'file') out += ` \\\n  --data-binary ${sq('@' + d.body.raw)}`;
      return out;
    }
    if (lang === 'fetch') {
      let pre = '';
      let bodyExpr = '';
      if (d.body.kind === 'raw' && d.body.raw) bodyExpr = q(d.body.raw);
      if (d.body.kind === 'form') {
        pre = 'const form = new FormData();\n' + d.body.fields.map((f) => (f.file ? `form.append(${q(f.k)}, new Blob([/* contenido de ${f.v} */]), ${q(f.v.split(/[\\/]/).pop())});` : `form.append(${q(f.k)}, ${q(f.v)});`)).join('\n') + '\n\n';
        bodyExpr = 'form';
      }
      if (d.body.kind === 'file') bodyExpr = `/* contenido de ${d.body.raw} */ await (await import('node:fs/promises')).readFile(${q(d.body.raw)})`;
      let out = `${pre}const res = await fetch(${q(d.url)}, {\n  method: ${q(d.method)}`;
      if (hs.length) out += `,\n  headers: {\n${hBlock('    ')}\n  }`;
      if (bodyExpr) out += `,\n  body: ${bodyExpr}`;
      return out + `\n});\nconst data = await res.text();\nconsole.log(res.status, data);`;
    }
    if (lang === 'axios') {
      let pre = "const axios = require('axios');\n";
      let dataExpr = '';
      if (d.body.kind === 'raw' && d.body.raw) dataExpr = q(d.body.raw);
      if (d.body.kind === 'form') {
        pre += "const FormData = require('form-data');\nconst form = new FormData();\n" + d.body.fields.map((f) => (f.file ? `form.append(${q(f.k)}, require('fs').createReadStream(${q(f.v)}));` : `form.append(${q(f.k)}, ${q(f.v)});`)).join('\n') + '\n';
        dataExpr = 'form';
      }
      if (d.body.kind === 'file') {
        pre += "const fs = require('fs');\n";
        dataExpr = `fs.readFileSync(${q(d.body.raw)})`;
      }
      let out = `${pre}\nconst res = await axios({\n  method: ${q(d.method.toLowerCase())},\n  url: ${q(d.url)}`;
      if (hs.length) out += `,\n  headers: {\n${hBlock('    ')}\n  }`;
      if (dataExpr) out += `,\n  data: ${dataExpr}`;
      return out + `\n});\nconsole.log(res.status, res.data);`;
    }
    // python
    const pq = (s) => JSON.stringify(String(s));
    let out = 'import requests\n\n';
    let extra = '';
    if (d.body.kind === 'form') {
      const textFields = d.body.fields.filter((f) => !f.file);
      const fileFields = d.body.fields.filter((f) => f.file);
      if (textFields.length) extra += `,\n    data={${textFields.map((f) => `${pq(f.k)}: ${pq(f.v)}`).join(', ')}}`;
      if (fileFields.length) extra += `,\n    files={${fileFields.map((f) => `${pq(f.k)}: open(${pq(f.v)}, "rb")`).join(', ')}}`;
    } else if (d.body.kind === 'raw' && d.body.raw) {
      extra += `,\n    data=${pq(d.body.raw)}`;
    } else if (d.body.kind === 'file') {
      extra += `,\n    data=open(${pq(d.body.raw)}, "rb")`;
    }
    out += `res = requests.request(\n    ${pq(d.method)},\n    ${pq(d.url)}`;
    if (hs.length) out += `,\n    headers={\n${hs.map(([k, v]) => `        ${pq(k)}: ${pq(v)}`).join(',\n')}\n    }`;
    return out + extra + `\n)\nprint(res.status_code, res.text)`;
  }

  function updateSnippet() {
    if (!req) return;
    $('snipCode').textContent = genSnippet($('snipLang').value);
  }
  $('snipLang').addEventListener('change', updateSnippet);

  function copy(textToCopy, btn) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = '¡Copiado!';
      setTimeout(() => (btn.textContent = old), 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textToCopy).then(done, () => {});
  }
  $('copySnip').addEventListener('click', () => copy($('snipCode').textContent, $('copySnip')));
  $('copyResp').addEventListener('click', () => {
    if (lastResponse) copy(lastResponse.body, $('copyResp'));
  });

  // =====================================================================
  //  Respuesta
  // =====================================================================
  function fmtSize(n) {
    return n < 1024 ? n + ' Bytes' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }
  function setStatus(html) {
    $('statusLine').innerHTML = html;
  }

  function highlightJson(src) {
    return esc(src).replace(
      /(&quot;(?:\\.|[^\\&])*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (m, str, colon, bool) => {
        if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
        if (bool) return `<span class="j-bool">${m}</span>`;
        if (m === 'null') return `<span class="j-null">${m}</span>`;
        return `<span class="j-num">${m}</span>`;
      }
    );
  }

  // JSONPath mínimo: $.a.b[0].c  $.lista[*].id  ['clave']
  function jsonPath(data, expr) {
    expr = expr.trim();
    if (!expr || expr === '$') return { value: data };
    if (expr[0] !== '$') expr = '$' + (expr[0] === '[' ? '' : '.') + expr;
    const re = /\.([A-Za-z0-9_\-$]+|\*)|\[(\d+|\*|'[^']*'|"[^"]*")\]/y;
    re.lastIndex = 1;
    let nodes = [data];
    let multi = false;
    while (re.lastIndex < expr.length) {
      const m = re.exec(expr);
      if (!m) throw new Error('Expresión no válida');
      const token = m[1] !== undefined ? m[1] : m[2];
      const next = [];
      for (const n of nodes) {
        if (n === null || typeof n !== 'object') continue;
        if (token === '*') {
          multi = true;
          next.push(...(Array.isArray(n) ? n : Object.values(n)));
        } else {
          const key = /^['"]/.test(token) ? token.slice(1, -1) : token;
          if (Object.prototype.hasOwnProperty.call(n, key)) next.push(n[key]);
        }
      }
      nodes = next;
    }
    if (!nodes.length) return { value: undefined };
    return { value: multi ? nodes : nodes[0] };
  }

  function currentJsonView() {
    if (parsedJson === undefined) return { empty: 'La respuesta no es JSON. Mira la vista Texto o Raw.' };
    const f = $('filter').value;
    try {
      const { value } = jsonPath(parsedJson, f);
      $('filterHint').textContent = 'JSONPath: aplica a las vistas JSON y Árbol.';
      if (value === undefined) return { empty: 'Sin resultados para esa expresión.' };
      return { value };
    } catch (e) {
      $('filterHint').textContent = e.message;
      return { empty: e.message };
    }
  }

  function treeNode(key, value, depth) {
    const label = key === null ? '' : `<span class="j-key">${esc(key)}</span>: `;
    if (value !== null && typeof value === 'object') {
      const isArr = Array.isArray(value);
      const entries = isArr ? value.map((v, i) => [String(i), v]) : Object.entries(value);
      const d = h('details');
      if (depth < 2) d.open = true;
      d.append(h('summary', { innerHTML: `${label}<span class="j-dim">${isArr ? `Array(${entries.length})` : `{${entries.length}}`}</span>` }));
      entries.forEach(([k, v]) => d.append(treeNode(k, v, depth + 1)));
      return d;
    }
    return h('div', { className: 'leaf', innerHTML: label + highlightJson(JSON.stringify(value)) });
  }

  function renderJsonViews() {
    const view = currentJsonView();
    if (view.empty) {
      $('respJson').innerHTML = `<div class="empty">${esc(view.empty)}</div>`;
      $('respTree').innerHTML = `<div class="empty">${esc(view.empty)}</div>`;
      return;
    }
    $('respJson').innerHTML = highlightJson(JSON.stringify(view.value, null, 2))
      .split('\n')
      .map((l) => `<div class="ln"><span>${l || ' '}</span></div>`)
      .join('');
    $('respTree').innerHTML = '';
    $('respTree').append(treeNode(null, view.value, 0));
  }
  $('filter').addEventListener('input', () => lastResponse && renderJsonViews());

  function updateRespView() {
    const v = $('respView').value;
    $('respJson').classList.toggle('hidden', v !== 'json');
    $('respTree').classList.toggle('hidden', v !== 'tree');
    $('respText').classList.toggle('hidden', v !== 'text');
    $('respRaw').classList.toggle('hidden', v !== 'raw');
    $('filter').parentElement.classList.toggle('hidden', v !== 'json' && v !== 'tree');
  }

  function table(headers, rows) {
    if (!rows.length) return '<div class="empty">Sin datos.</div>';
    return `<table><thead><tr>${headers.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
  }

  function renderResults(r) {
    const passed = r.tests.filter((t) => t.pass).length;
    let html = '';
    if (r.tests.length) {
      html += `<div class="res-summary">${passed}/${r.tests.length} pruebas correctas</div>`;
      html += r.tests
        .map((t) => `<div class="res-item ${t.pass ? 'pass' : 'fail'}"><span class="mark">${t.pass ? '✓' : '✗'}</span><div>${esc(t.name)}<div class="detail">${esc(t.detail)}</div></div></div>`)
        .join('');
    }
    if (r.varMessages.length) {
      html += '<div class="res-title">Set Env Variable</div>' + r.varMessages.map((m) => `<div class="log-line">${esc(m)}</div>`).join('');
    }
    if (r.logs.length) {
      html += '<div class="res-title">Consola (Pre Run)</div>' + r.logs.map((m) => `<div class="log-line">${esc(m)}</div>`).join('');
    }
    $('respResults').innerHTML = html || '<div class="empty">Esta petición no tiene tests. Agrégalos en la pestaña Tests.</div>';
    setCount('cnt-rresults', r.tests.length, passed !== r.tests.length);
    $('cnt-rresults').textContent = r.tests.length ? `${passed}/${r.tests.length}` : '';
  }

  function showResponse(r) {
    lastResponse = r;
    $('send').disabled = false;
    $('send').textContent = 'Enviar';
    if (r.error) {
      setStatus(`<span class="err"><b>Error:</b> ${esc(r.error)}</span>`);
      ['respText', 'respRaw'].forEach((id) => ($(id).textContent = ''));
      ['respJson', 'respTree', 'respHeaders', 'respCookies'].forEach((id) => ($(id).innerHTML = ''));
      renderResults(r);
      ['cnt-rheaders', 'cnt-rcookies'].forEach((id) => setCount(id, 0));
      return;
    }
    const cls = r.ok ? 'ok' : 'err';
    setStatus(
      `<span>Estado: <b class="${cls}">${r.status} ${esc(r.statusText)}</b></span>` +
        `<span>Tamaño: <b class="${cls}">${fmtSize(r.size)}</b></span>` +
        `<span>Tiempo: <b class="${cls}">${r.timeMs} ms</b></span>`
    );
    try {
      parsedJson = JSON.parse(r.body);
    } catch (_) {
      parsedJson = undefined;
    }
    $('respText').textContent = r.body || '(respuesta vacía)';
    $('respRaw').textContent = `HTTP ${r.status} ${r.statusText}\n` + r.headers.map(([k, v]) => k + ': ' + v).join('\n') + '\n\n' + r.body;
    $('respHeaders').innerHTML = table(['Header', 'Valor'], r.headers);
    $('respCookies').innerHTML = table(['Nombre', 'Valor', 'Atributos'], r.cookies.map((c) => [c.name, c.value, c.attrs]));
    setCount('cnt-rheaders', r.headers.length);
    setCount('cnt-rcookies', r.cookies.length);
    renderResults(r);
    renderJsonViews();
    setPill('respView', parsedJson !== undefined ? 'json' : 'text');
    updateRespView();
    showTab('res', 'rbody');
  }

  // =====================================================================
  //  Mensajes desde la extensión
  // =====================================================================
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'init') {
      req = msg.request;
      vars = msg.vars || {};
      $('envBadge').textContent = msg.env ? 'Entorno: ' + msg.env : '';
      loadUI();
      updateRespView();
      if (!req.url) $('url').focus();
    } else if (msg.type === 'env') {
      vars = msg.vars || {};
      $('envBadge').textContent = msg.env ? 'Entorno: ' + msg.env : '';
      updateSnippet();
    } else if (msg.type === 'response') {
      showResponse(msg.result);
    } else if (msg.type === 'file') {
      if (msg.target === 'binary') {
        $('binaryPath').value = msg.path;
      } else {
        const row = $('formFields').children[msg.index];
        if (row) row.querySelectorAll('input[type=text]')[1].value = msg.path;
      }
      onChange();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
