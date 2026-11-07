/**
 * Almacén de cookies, inspirado en RFC 6265 y simplificado: dominio, ruta, expiración, Secure.
 * No implementa SameSite (es una política de navegador) ni la lista de sufijos públicos.
 * Las cookies de sesión son credenciales: se guardan en .api-request/cookies.json, que la
 * extensión deja fuera de git (ver Store.ensureGitignore).
 */
export interface StoredCookie {
  name: string;
  value: string;
  /** dominio en minúsculas, sin punto inicial */
  domain: string;
  /** true: solo coincide con ese host exacto (la cookie no traía Domain) */
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** milisegundos desde 1970; null = cookie de sesión */
  expires: number | null;
}

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^\[.*\]$/;

function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) {
    return '/';
  }
  const i = pathname.lastIndexOf('/');
  return i <= 0 ? '/' : pathname.slice(0, i);
}

function domainMatches(host: string, c: StoredCookie): boolean {
  return c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain);
}

function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) {
    return true;
  }
  if (!reqPath.startsWith(cookiePath)) {
    return false;
  }
  return cookiePath.endsWith('/') || reqPath.charAt(cookiePath.length) === '/';
}

export class CookieJar {
  private cookies: StoredCookie[];

  constructor(initial: StoredCookie[] = []) {
    this.cookies = Array.isArray(initial) ? initial.filter((c) => c && c.name && c.domain) : [];
  }

  /** Procesa las líneas Set-Cookie recibidas de `requestUrl`. Devuelve true si el almacén cambió. */
  store(setCookieLines: string[], requestUrl: string, now = Date.now()): boolean {
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      return false;
    }
    const host = url.hostname.toLowerCase();
    let changed = false;
    for (const line of setCookieLines) {
      const c = this.parse(line, url, host, now);
      if (!c) {
        continue;
      }
      // sustituye la cookie con el mismo nombre, dominio y ruta
      const same = (x: StoredCookie) => x.name === c.cookie.name && x.domain === c.cookie.domain && x.path === c.cookie.path && x.hostOnly === c.cookie.hostOnly;
      const before = this.cookies.length;
      this.cookies = this.cookies.filter((x) => !same(x));
      if (c.expired) {
        changed = changed || before !== this.cookies.length;
      } else {
        this.cookies.push(c.cookie);
        changed = true;
      }
    }
    return changed;
  }

  private parse(line: string, url: URL, host: string, now: number): { cookie: StoredCookie; expired: boolean } | undefined {
    const parts = line.split(';');
    const first = parts.shift() ?? '';
    const eq = first.indexOf('=');
    if (eq <= 0) {
      return undefined; // sin nombre o sin "="
    }
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) {
      return undefined;
    }
    let domain = host;
    let hostOnly = true;
    let path = defaultPath(url.pathname);
    let secure = false;
    let httpOnly = false;
    let expires: number | null = null;
    let maxAge: number | undefined;
    for (const raw of parts) {
      const j = raw.indexOf('=');
      const key = (j < 0 ? raw : raw.slice(0, j)).trim().toLowerCase();
      const val = j < 0 ? '' : raw.slice(j + 1).trim();
      if (key === 'domain' && val) {
        const d = val.replace(/^\./, '').toLowerCase();
        // solo se acepta si el host de la petición pertenece a ese dominio (evita cookies de terceros)
        if (IP_RE.test(host) ? d !== host : !(host === d || host.endsWith('.' + d))) {
          return undefined;
        }
        domain = d;
        hostOnly = false;
      } else if (key === 'path' && val.startsWith('/')) {
        path = val;
      } else if (key === 'secure') {
        secure = true;
      } else if (key === 'httponly') {
        httpOnly = true;
      } else if (key === 'max-age') {
        const n = Number(val);
        if (/^-?\d+$/.test(val) && Number.isFinite(n)) {
          maxAge = n;
        }
      } else if (key === 'expires') {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) {
          expires = t;
        }
      }
    }
    if (maxAge !== undefined) {
      expires = now + maxAge * 1000; // Max-Age manda sobre Expires
    }
    // una cookie Secure solo puede fijarse desde una conexión segura
    if (secure && url.protocol !== 'https:') {
      return undefined;
    }
    const expired = expires !== null && expires <= now;
    return { cookie: { name, value, domain, hostOnly, path, secure, httpOnly, expires }, expired };
  }

  /** Valor del header Cookie para esa URL ('' si no hay cookies que enviar). */
  headerFor(requestUrl: string, now = Date.now()): string {
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      return '';
    }
    this.purgeExpired(now);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname || '/';
    return this.cookies
      .filter((c) => domainMatches(host, c) && pathMatches(pathname, c.path) && (!c.secure || url.protocol === 'https:'))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  private purgeExpired(now: number) {
    this.cookies = this.cookies.filter((c) => c.expires === null || c.expires > now);
  }

  list(): StoredCookie[] {
    return this.cookies.map((c) => ({ ...c }));
  }

  /** Cuántas cookies hay por dominio. */
  domains(): { domain: string; count: number }[] {
    const m = new Map<string, number>();
    for (const c of this.cookies) {
      m.set(c.domain, (m.get(c.domain) ?? 0) + 1);
    }
    return [...m].map(([domain, count]) => ({ domain, count })).sort((a, b) => a.domain.localeCompare(b.domain));
  }

  /** Borra las cookies de un dominio (o todas). Devuelve cuántas se borraron. */
  clear(domain?: string): number {
    const before = this.cookies.length;
    this.cookies = domain ? this.cookies.filter((c) => c.domain !== domain) : [];
    return before - this.cookies.length;
  }

  toJSON(): StoredCookie[] {
    return this.cookies;
  }
}
