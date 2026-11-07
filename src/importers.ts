import { randomUUID } from 'crypto';
import { ApiRequest, BodyType, Folder, KV } from './types';
import { normalizeRequest } from './model';

export interface ImportedCollection {
  name: string;
  /** peticiones de la raíz de la colección */
  requests: ApiRequest[];
  /** carpetas reales (anidadas) con sus peticiones */
  folders: Folder[];
}

/** Cuenta peticiones y carpetas de toda la jerarquía importada. */
export function countImported(c: { requests: ApiRequest[]; folders: Folder[] }): { requests: number; folders: number } {
  let requests = c.requests.length;
  let folders = c.folders.length;
  for (const f of c.folders) {
    const n = countImported(f);
    requests += n.requests;
    folders += n.folders;
  }
  return { requests, folders };
}

const mkFolder = (name: string): Folder => ({ id: randomUUID(), name, requests: [], folders: [] });

const mk = (partial: Record<string, unknown>): ApiRequest => normalizeRequest({ id: randomUUID(), ...partial });

// =====================================================================
//  cURL
// =====================================================================
function tokenize(cmd: string): string[] {
  // Une continuaciones de línea (\ + salto) y las "\ " que deja un pegado en una sola línea
  const text = cmd
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\s\\\s+(?=-)/g, ' ')
    .trim();
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let has = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else if (ch === '\\' && quote === '"' && i + 1 < text.length) {
        cur += text[++i];
      } else {
        cur += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) {
        out.push(cur);
        cur = '';
        has = false;
      }
    } else if (ch === '\\' && i + 1 < text.length) {
      cur += text[++i];
    } else {
      cur += ch;
    }
  }
  if (has || cur) {
    out.push(cur);
  }
  return out;
}

export function parseCurl(command: string): ApiRequest | undefined {
  const tokens = tokenize(command);
  if (!tokens.length || tokens[0].toLowerCase() !== 'curl') {
    return undefined;
  }
  let method = '';
  let url = '';
  const headers: KV[] = [];
  const dataParts: string[] = [];
  const formFields: { key: string; value: string; type: 'text' | 'file' }[] = [];
  let user = '';
  let cookie = '';

  const takesValue = new Set([
    '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
    '--data-urlencode', '-u', '--user', '--url', '-F', '--form', '-b', '--cookie', '-A', '--user-agent',
    '-o', '--output', '-e', '--referer', '--max-time', '-m', '--connect-timeout', '-x', '--proxy',
  ]);

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('-') && t.length > 1) {
      let flag = t;
      let value: string | undefined;
      const eq = t.startsWith('--') ? t.indexOf('=') : -1;
      if (eq > 0) {
        flag = t.slice(0, eq);
        value = t.slice(eq + 1);
      } else if (takesValue.has(t)) {
        value = tokens[++i];
      } else if (/^-[XHduFbA]./.test(t)) {
        flag = t.slice(0, 2);
        value = t.slice(2);
      }
      switch (flag) {
        case '-X':
        case '--request':
          method = (value || '').toUpperCase();
          break;
        case '-H':
        case '--header': {
          const j = (value || '').indexOf(':');
          if (j > 0) {
            headers.push({ enabled: true, key: value!.slice(0, j).trim(), value: value!.slice(j + 1).trim() });
          }
          break;
        }
        case '-d':
        case '--data':
        case '--data-raw':
        case '--data-binary':
        case '--data-ascii':
        case '--data-urlencode':
          dataParts.push(value || '');
          break;
        case '-u':
        case '--user':
          user = value || '';
          break;
        case '--url':
          url = value || '';
          break;
        case '-F':
        case '--form': {
          const j = (value || '').indexOf('=');
          if (j > 0) {
            const v = value!.slice(j + 1);
            formFields.push(
              v.startsWith('@')
                ? { key: value!.slice(0, j), value: v.slice(1), type: 'file' }
                : { key: value!.slice(0, j), value: v, type: 'text' }
            );
          }
          break;
        }
        case '-b':
        case '--cookie':
          cookie = value || '';
          break;
        case '-A':
        case '--user-agent':
          headers.push({ enabled: true, key: 'User-Agent', value: value || '' });
          break;
        default:
          break; // -L -s -k --compressed -i -v ...
      }
    } else if (!url) {
      url = t;
    }
  }
  if (!url) {
    return undefined;
  }
  if (cookie) {
    headers.push({ enabled: true, key: 'Cookie', value: cookie });
  }

  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
  const raw = dataParts.join('&');
  let bodyType: BodyType = 'none';
  const body: Record<string, unknown> = {};
  if (formFields.length) {
    bodyType = 'form';
    body.form = formFields.map((f) => ({ enabled: true, ...f }));
  } else if (raw) {
    if (ct.includes('x-www-form-urlencoded')) {
      bodyType = 'formurl';
      body.formurl = raw.split('&').filter(Boolean).map((p) => {
        const i = p.indexOf('=');
        const dec = (s: string) => {
          try {
            return decodeURIComponent(s.replace(/\+/g, ' '));
          } catch {
            return s;
          }
        };
        return { enabled: true, key: dec(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : dec(p.slice(i + 1)) };
      });
    } else if (ct.includes('json') || /^\s*[\[{]/.test(raw)) {
      bodyType = 'json';
      body.content = raw;
    } else if (ct.includes('xml')) {
      bodyType = 'xml';
      body.content = raw;
    } else {
      bodyType = 'text';
      body.content = raw;
    }
  }
  body.type = bodyType;

  const auth: Record<string, unknown> = { type: 'none' };
  if (user) {
    const i = user.indexOf(':');
    auth.type = 'basic';
    auth.username = i < 0 ? user : user.slice(0, i);
    auth.password = i < 0 ? '' : user.slice(i + 1);
  }

  if (!method) {
    method = bodyType !== 'none' ? 'POST' : 'GET';
  }
  let name = url;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'http://' + url);
    name = `${method} ${u.pathname}`;
  } catch {
    /* se queda con la URL */
  }
  return mk({ name, method, url, headers, body, auth });
}

// =====================================================================
//  Postman v2.1
// =====================================================================
function postmanRequest(item: any): ApiRequest | undefined {
  const r = item.request;
  if (!r || typeof r === 'string') {
    return undefined;
  }
  const url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
  const headers: KV[] = (r.header || []).map((h: any) => ({
    enabled: !h.disabled,
    key: h.key || '',
    value: h.value || '',
  }));
  const body: Record<string, unknown> = { type: 'none' };
  const b = r.body;
  if (b) {
    if (b.mode === 'raw') {
      const lang = b.options?.raw?.language;
      body.type = lang === 'xml' ? 'xml' : lang === 'text' ? 'text' : lang === 'json' || /^\s*[\[{]/.test(b.raw || '') ? 'json' : 'text';
      body.content = b.raw || '';
    } else if (b.mode === 'urlencoded') {
      body.type = 'formurl';
      body.formurl = (b.urlencoded || []).map((f: any) => ({ enabled: !f.disabled, key: f.key || '', value: f.value || '' }));
    } else if (b.mode === 'formdata') {
      body.type = 'form';
      body.form = (b.formdata || []).map((f: any) => ({
        enabled: !f.disabled,
        key: f.key || '',
        type: f.type === 'file' ? 'file' : 'text',
        value: f.type === 'file' ? (Array.isArray(f.src) ? f.src[0] : f.src) || '' : f.value || '',
      }));
    } else if (b.mode === 'graphql') {
      body.type = 'graphql';
      body.gqlQuery = b.graphql?.query || '';
      body.gqlVars = b.graphql?.variables || '';
    }
  }
  const auth: Record<string, unknown> = { type: 'none' };
  const a = r.auth;
  const field = (arr: any[] | undefined, key: string) => arr?.find((x) => x.key === key)?.value ?? '';
  if (a?.type === 'bearer') {
    auth.type = 'bearer';
    auth.token = field(a.bearer, 'token');
  } else if (a?.type === 'basic') {
    auth.type = 'basic';
    auth.username = field(a.basic, 'username');
    auth.password = field(a.basic, 'password');
  } else if (a?.type === 'apikey') {
    auth.type = 'apikey';
    auth.keyName = field(a.apikey, 'key');
    auth.keyValue = field(a.apikey, 'value');
    auth.keyIn = field(a.apikey, 'in') === 'query' ? 'query' : 'header';
  }
  const desc = typeof r.description === 'string' ? r.description : r.description?.content || '';
  return mk({
    name: item.name || 'Petición',
    method: (r.method || 'GET').toUpperCase(),
    url,
    headers,
    body,
    auth,
    description: desc,
  });
}

function walkPostman(items: any[], target: { requests: ApiRequest[]; folders: Folder[] }) {
  for (const it of items || []) {
    if (Array.isArray(it.item)) {
      const folder = mkFolder(it.name || 'Carpeta');
      walkPostman(it.item, folder);
      target.folders.push(folder);
    } else {
      const r = postmanRequest(it);
      if (r) {
        target.requests.push(r);
      }
    }
  }
}

// =====================================================================
//  Thunder Client (export JSON)
// =====================================================================
function thunderRequest(r: any): ApiRequest {
  const headers: KV[] = (r.headers || []).map((h: any) => ({ enabled: !h.isDisabled, key: h.name || '', value: h.value || '' }));
  const b = r.body || {};
  const body: Record<string, unknown> = { type: 'none' };
  switch (b.type) {
    case 'json':
    case 'xml':
    case 'text':
      body.type = b.type;
      body.content = b.raw || '';
      break;
    case 'formencoded':
      body.type = 'formurl';
      body.formurl = (b.form || []).map((f: any) => ({ enabled: !f.isDisabled, key: f.name || '', value: f.value || '' }));
      break;
    case 'formdata':
      body.type = 'form';
      body.form = (b.form || []).map((f: any) => ({ enabled: !f.isDisabled, key: f.name || '', type: 'text', value: f.value || '' }));
      break;
    case 'graphql':
      body.type = 'graphql';
      body.gqlQuery = b.graphql?.query || '';
      body.gqlVars = b.graphql?.variables || '';
      break;
    default:
      if (b.raw) {
        body.type = 'text';
        body.content = b.raw;
      }
  }
  const auth: Record<string, unknown> = { type: 'none' };
  if (r.auth?.type === 'bearer') {
    auth.type = 'bearer';
    auth.token = r.auth.bearer || '';
  } else if (r.auth?.type === 'basic') {
    auth.type = 'basic';
    auth.username = r.auth.basic?.username || '';
    auth.password = r.auth.basic?.password || '';
  }
  return mk({
    name: r.name || 'Petición',
    method: (r.method || 'GET').toUpperCase(),
    url: r.url || '',
    headers,
    body,
    auth,
  });
}

/** Detecta el formato (Postman v2.1 o Thunder Client) y lo convierte. */
export function parseCollectionJson(text: string): ImportedCollection | undefined {
  let json: any;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
  if (json?.info && Array.isArray(json.item)) {
    const root = { requests: [] as ApiRequest[], folders: [] as Folder[] };
    walkPostman(json.item, root);
    return { name: json.info.name || 'Postman', ...root };
  }
  if (Array.isArray(json?.requests)) {
    // Carpetas de Thunder Client: _id y containerId (carpeta padre; vacío = raíz). Se tolera un ciclo.
    const byId = new Map<string, Folder>();
    const parentOf = new Map<string, string>();
    for (const f of json.folders || []) {
      byId.set(f._id, mkFolder(f.name || 'Carpeta'));
      parentOf.set(f._id, f.containerId || '');
    }
    const root = { requests: [] as ApiRequest[], folders: [] as Folder[] };
    const hasCycle = (id: string) => {
      const seen = new Set<string>();
      for (let cur = parentOf.get(id); cur; cur = parentOf.get(cur)) {
        if (cur === id || seen.has(cur)) {
          return true;
        }
        seen.add(cur);
      }
      return false;
    };
    for (const [id, folder] of byId) {
      const parent = parentOf.get(id) ? byId.get(parentOf.get(id) as string) : undefined;
      (parent && !hasCycle(id) ? parent : root).folders.push(folder);
    }
    for (const r of json.requests) {
      (byId.get(r.containerId) ?? root).requests.push(thunderRequest(r));
    }
    return { name: json.collectionName || 'Thunder Client', ...root };
  }
  return undefined;
}
