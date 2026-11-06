import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { ApiRequest, CookieInfo, ResponseResult } from './types';
import { substitute } from './vars';
import { extractSource, parseTarget, runAssertions } from './tests';

export { substitute };

export interface SendContext {
  vars: Record<string, string>;
  options: { timeoutMs: number; followRedirects: boolean };
  /** value === null borra la variable */
  setVar: (name: string, value: string | null, scope: 'active' | 'global') => void;
}

function isTextual(contentType: string, buf: Buffer): boolean {
  if (/json|text|xml|javascript|html|x-www-form-urlencoded|svg|graphql/i.test(contentType)) {
    return true;
  }
  if (contentType) {
    return false;
  }
  return !buf.subarray(0, 512).includes(0);
}

function parseCookies(lines: string[]): CookieInfo[] {
  return lines.map((line) => {
    const [first, ...rest] = line.split(';');
    const i = first.indexOf('=');
    return {
      name: (i < 0 ? first : first.slice(0, i)).trim(),
      value: i < 0 ? '' : first.slice(i + 1).trim(),
      attrs: rest.map((s) => s.trim()).join('; '),
    };
  });
}

function errMessage(e: unknown): string {
  const err = e as { message?: string; cause?: { message?: string; code?: string } };
  return err?.cause?.code || err?.cause?.message || err?.message || String(e);
}

function readFileOrThrow(file: string, what: string): Buffer {
  const f = file.trim();
  if (!f) {
    throw new Error(`${what}: no se seleccionó ningún archivo.`);
  }
  try {
    return fs.readFileSync(f);
  } catch {
    throw new Error(`${what}: no se pudo leer "${f}".`);
  }
}

export async function sendRequest(req: ApiRequest, ctx: SendContext): Promise<ResponseResult> {
  const vars: Record<string, string> = { ...ctx.vars, request_name: req.name };
  const logs: string[] = [];

  // ---------- Pre Run ----------
  if (req.preRun && req.preRun.trim()) {
    const tc = {
      setVar: (name: string, value: unknown, scope?: string) => {
        vars[name] = String(value);
        ctx.setVar(name, String(value), scope === 'global' ? 'global' : 'active');
      },
      getVar: (name: string) => vars[name],
    };
    const sandbox = {
      tc,
      console: {
        log: (...a: unknown[]) =>
          logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
      },
    };
    try {
      vm.runInNewContext(req.preRun, sandbox, { timeout: 1000 });
    } catch (e) {
      return failure('Error en Pre Run: ' + errMessage(e), 0, logs);
    }
  }

  const sub = (s: string) => substitute(s ?? '', vars);
  const method = (req.method || 'GET').toUpperCase();

  let url = sub(req.url).trim();
  if (!url) {
    return failure('La URL está vacía.', 0, logs);
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = 'http://' + url;
  }

  // ---------- Headers + Auth ----------
  const headers: Record<string, string> = {};
  for (const h of req.headers || []) {
    if (h.enabled && h.key.trim()) {
      headers[sub(h.key.trim())] = sub(h.value);
    }
  }
  const hasHeader = (name: string) =>
    Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());

  const auth = req.auth;
  if (auth?.type === 'bearer' && auth.token && !hasHeader('authorization')) {
    headers['Authorization'] = 'Bearer ' + sub(auth.token);
  } else if (auth?.type === 'basic' && !hasHeader('authorization')) {
    const raw = `${sub(auth.username)}:${sub(auth.password)}`;
    headers['Authorization'] = 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
  } else if (auth?.type === 'apikey' && auth.keyName.trim()) {
    const k = sub(auth.keyName.trim());
    const v = sub(auth.keyValue);
    if (auth.keyIn === 'query') {
      url += (url.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    } else {
      headers[k] = v;
    }
  }

  // ---------- Body ----------
  let body: string | Buffer | FormData | URLSearchParams | undefined;
  const b = req.body;
  if (b && b.type !== 'none' && !['GET', 'HEAD'].includes(method)) {
    try {
      switch (b.type) {
        case 'json':
          body = sub(b.content);
          if (!hasHeader('content-type')) headers['Content-Type'] = 'application/json';
          break;
        case 'xml':
          body = sub(b.content);
          if (!hasHeader('content-type')) headers['Content-Type'] = 'application/xml';
          break;
        case 'text':
          body = sub(b.content);
          if (!hasHeader('content-type')) headers['Content-Type'] = 'text/plain';
          break;
        case 'formurl': {
          const params = new URLSearchParams();
          for (const f of b.formurl || []) {
            if (f.enabled && f.key.trim()) params.append(sub(f.key.trim()), sub(f.value));
          }
          body = params.toString();
          if (!hasHeader('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
          break;
        }
        case 'form': {
          const fd = new FormData();
          for (const f of b.form || []) {
            if (!f.enabled || !f.key.trim()) continue;
            if (f.type === 'file') {
              const file = sub(f.value);
              fd.append(sub(f.key.trim()), new Blob([readFileOrThrow(file, `Campo "${f.key}"`)]), path.basename(file));
            } else {
              fd.append(sub(f.key.trim()), sub(f.value));
            }
          }
          body = fd; // fetch genera el boundary
          break;
        }
        case 'graphql': {
          let variables: unknown = {};
          const vtxt = sub(b.gqlVars || '').trim();
          if (vtxt) {
            try {
              variables = JSON.parse(vtxt);
            } catch {
              throw new Error('Las variables de GraphQL no son un JSON válido.');
            }
          }
          body = JSON.stringify({ query: sub(b.gqlQuery || ''), variables });
          if (!hasHeader('content-type')) headers['Content-Type'] = 'application/json';
          break;
        }
        case 'binary':
          body = readFileOrThrow(sub(b.file || ''), 'Body binario');
          if (!hasHeader('content-type')) headers['Content-Type'] = 'application/octet-stream';
          break;
      }
    } catch (e) {
      return failure(errMessage(e), 0, logs);
    }
  }

  // ---------- Envío ----------
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.options.timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body as any,
      signal: controller.signal,
      redirect: ctx.options.followRedirects ? 'follow' : 'manual',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const timeMs = Date.now() - start;
    const contentType = res.headers.get('content-type') || '';
    const resHeaders: [string, string][] = [];
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') resHeaders.push([key, value]);
    });
    const setCookies: string[] = (res.headers as any).getSetCookie?.() ?? [];
    setCookies.forEach((c) => resHeaders.push(['set-cookie', c]));
    const cookies = parseCookies(setCookies);
    const text = isTextual(contentType, buf)
      ? new TextDecoder('utf-8').decode(buf)
      : `[Contenido binario: ${buf.length} bytes, ${contentType || 'tipo desconocido'}]`;

    // ---------- Tests + Set Env Variable ----------
    const view = { status: res.status, timeMs, headers: resHeaders, cookies, body: text };
    const tests = runAssertions(req.tests?.assertions ?? [], view, sub);
    const varMessages: string[] = [];
    for (const sv of req.tests?.setVars ?? []) {
      if (!sv.enabled || !sv.source.trim()) continue;
      const target = parseTarget(sv.target);
      if (!target) {
        varMessages.push(`✗ Destino no válido: ${sv.target || '(vacío)'}  (usa {{variable}})`);
        continue;
      }
      const ex = extractSource(sv.source, view, sub);
      if (ex.kind === 'missing') {
        varMessages.push(`✗ {{${target.name}}}: no se encontró "${sv.source}" en la respuesta`);
      } else if (ex.kind === 'delete') {
        ctx.setVar(target.name, null, target.scope);
        delete vars[target.name];
        varMessages.push(`✓ {{${target.name}}} eliminada (${target.scope === 'global' ? 'global' : 'entorno activo'})`);
      } else {
        ctx.setVar(target.name, ex.value, target.scope);
        vars[target.name] = ex.value;
        const shown = ex.value.length > 60 ? ex.value.slice(0, 57) + '…' : ex.value;
        varMessages.push(
          `✓ {{${target.name}}} = ${shown}  (${target.scope === 'global' ? 'global' : 'entorno activo'})`
        );
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      timeMs,
      size: buf.length,
      headers: resHeaders,
      cookies,
      body: text,
      tests,
      varMessages,
      logs,
    };
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name;
    const msg =
      name === 'AbortError'
        ? `Tiempo de espera agotado (${ctx.options.timeoutMs / 1000}s).`
        : errMessage(e);
    return failure(msg, Date.now() - start, logs);
  } finally {
    clearTimeout(timer);
  }
}

function failure(message: string, timeMs: number, logs: string[]): ResponseResult {
  return {
    ok: false,
    status: 0,
    statusText: '',
    timeMs,
    size: 0,
    headers: [],
    cookies: [],
    body: '',
    tests: [],
    varMessages: [],
    logs,
    error: message,
  };
}
