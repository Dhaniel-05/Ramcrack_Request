import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { ApiRequest, CookieInfo, ResponseResult } from './types';
import { CookieJar } from './cookiejar';
import { substitute } from './vars';
import { extractSource, parseTarget, runAssertions } from './tests';

export { substitute };

export interface SendContext {
  /** Almacén de cookies compartido entre peticiones. Sin él, no se guardan ni se envían cookies. */
  cookieJar?: CookieJar;
  vars: Record<string, string>;
  options: { timeoutMs: number; followRedirects: boolean };
  /** Nombre del entorno activo ('' = ninguno: lo guardado va a Globales). Solo afecta a los mensajes. */
  activeEnv?: string;
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

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
  '.json': 'application/json', '.xml': 'application/xml', '.html': 'text/html', '.css': 'text/css',
  '.js': 'text/javascript', '.md': 'text/markdown', '.zip': 'application/zip',
  '.gz': 'application/gzip', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * Tipo de contenido deducido de la extensión del archivo, como hace un navegador.
 * Sin esto, el servidor recibe el archivo como "application/octet-stream" y muchas APIs
 * (por ejemplo las que aceptan solo image/png o image/jpeg) lo rechazan.
 */
export function mimeFromPath(file: string): string {
  return MIME_BY_EXT[path.extname(file.trim()).toLowerCase()] ?? 'application/octet-stream';
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

  // ---------- Pre-ejecución ----------
  if (req.preRun && req.preRun.trim()) {
    // API de los scripts: rr.setVar(nombre, valor[, 'global']) y rr.getVar(nombre)
    const rr = {
      setVar: (name: string, value: unknown, scope?: string) => {
        vars[name] = String(value);
        ctx.setVar(name, String(value), scope === 'global' ? 'global' : 'active');
      },
      getVar: (name: string) => vars[name],
    };
    const sandbox = {
      rr,
      // Alias antiguo (versiones 0.1.x y 0.2.x). Se mantiene por compatibilidad con scripts ya
      // escritos; se retirará en una versión futura. Los scripts nuevos deben usar `rr`.
      tc: rr,
      console: {
        log: (...a: unknown[]) =>
          logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
      },
    };
    try {
      vm.runInNewContext(req.preRun, sandbox, { timeout: 1000 });
    } catch (e) {
      return failure('Error en la pre-ejecución: ' + errMessage(e), 0, logs);
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
              fd.append(
                sub(f.key.trim()),
                new Blob([readFileOrThrow(file, `Campo "${f.key}"`)], { type: mimeFromPath(file) }),
                path.basename(file)
              );
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
          if (!hasHeader('content-type')) headers['Content-Type'] = mimeFromPath(sub(b.file || ''));
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
    const jar = ctx.cookieJar;
    const userCookie = hasHeader('cookie'); // un Cookie escrito a mano tiene prioridad sobre el almacén
    let curUrl = url;
    let curMethod = method;
    let curBody = body;
    let baseHeaders = headers;
    let res: Response;
    for (let hops = 0; ; hops++) {
      const hopHeaders = { ...baseHeaders };
      if (jar && !userCookie) {
        const c = jar.headerFor(curUrl);
        if (c) hopHeaders['Cookie'] = c;
      }
      // Con almacén de cookies las redirecciones se siguen a mano: fetch no guarda las cookies de los saltos.
      res = await fetch(curUrl, {
        method: curMethod,
        headers: hopHeaders,
        body: curBody as any,
        signal: controller.signal,
        redirect: jar ? 'manual' : ctx.options.followRedirects ? 'follow' : 'manual',
      });
      if (!jar) break;
      jar.store((res.headers as any).getSetCookie?.() ?? [], curUrl);
      const loc = res.headers.get('location');
      if (!ctx.options.followRedirects || !loc || ![301, 302, 303, 307, 308].includes(res.status)) break;
      if (hops >= 10) {
        return failure('Demasiadas redirecciones (más de 10).', Date.now() - start, logs);
      }
      const next = new URL(loc, curUrl);
      if (next.origin !== new URL(curUrl).origin) {
        // al cambiar de origen no se reenvían credenciales
        baseHeaders = Object.fromEntries(Object.entries(baseHeaders).filter(([k]) => !/^(authorization|cookie)$/i.test(k)));
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod === 'POST')) {
        curMethod = curMethod === 'HEAD' ? 'HEAD' : 'GET';
        curBody = undefined;
        baseHeaders = Object.fromEntries(Object.entries(baseHeaders).filter(([k]) => !/^content-(type|length)$/i.test(k)));
      }
      curUrl = next.toString();
    }
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

    // ---------- Tests + Guardar en variable ----------
    const view = { status: res.status, timeMs, headers: resHeaders, cookies, body: text };
    const tests = runAssertions(req.tests?.assertions ?? [], view, sub);
    const varMessages: string[] = [];
    const where = (scope: 'active' | 'global') =>
      scope === 'global' || ctx.activeEnv === ''
        ? 'global'
        : ctx.activeEnv
          ? `entorno "${ctx.activeEnv}"`
          : 'entorno activo';
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
        varMessages.push(`✓ {{${target.name}}} eliminada (${where(target.scope)})`);
      } else {
        ctx.setVar(target.name, ex.value, target.scope);
        vars[target.name] = ex.value;
        const shown = ex.value.length > 60 ? ex.value.slice(0, 57) + '…' : ex.value;
        varMessages.push(
          `✓ {{${target.name}}} = ${shown}  (${where(target.scope)})`
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
