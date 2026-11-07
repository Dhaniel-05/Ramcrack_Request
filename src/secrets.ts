import { ApiRequest } from './types';

/** Nombres de campo que casi siempre llevan un secreto. */
const SECRET_KEY = /^(password|passwd|pwd|pass|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|api[_-]?key|apikey|authorization|x-api-key)$/i;

/** Un valor "literal" es el que no es vacío y no está hecho solo de variables {{...}}. */
export function isLiteral(value: string | undefined): boolean {
  const v = (value ?? '').trim();
  return v.length > 0 && v.replace(/\{\{[^}]*\}\}/g, '').trim().length > 0;
}

/**
 * Devuelve dónde hay un valor sensible escrito a mano (no una variable) en la petición.
 * Se guarda en texto plano en .api-request/collections.json, que suele subirse a git.
 */
export function findPlainSecrets(req: ApiRequest): string[] {
  const found: string[] = [];
  const auth = req.auth;
  if (auth) {
    if (auth.type === 'bearer' && isLiteral(auth.token)) found.push('Auth: token Bearer');
    if (auth.type === 'basic' && isLiteral(auth.password)) found.push('Auth: contraseña Basic');
    if (auth.type === 'apikey' && isLiteral(auth.keyValue)) found.push(`Auth: API key${auth.keyName ? ` "${auth.keyName}"` : ''}`);
  }
  for (const h of req.headers || []) {
    if (h.enabled && SECRET_KEY.test(h.key.trim()) && isLiteral(h.value)) found.push(`Headers: ${h.key.trim()}`);
  }
  const b = req.body;
  if (b) {
    for (const f of b.formurl || []) {
      if (f.enabled && SECRET_KEY.test(f.key.trim()) && isLiteral(f.value)) found.push(`Body: ${f.key.trim()}`);
    }
    for (const f of b.form || []) {
      if (f.enabled && f.type !== 'file' && SECRET_KEY.test(f.key.trim()) && isLiteral(f.value)) found.push(`Body: ${f.key.trim()}`);
    }
    if (b.type === 'json' && b.content) {
      const re = /"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(b.content))) {
        if (SECRET_KEY.test(m[1]) && isLiteral(m[2])) found.push(`Body JSON: ${m[1]}`);
      }
    }
  }
  return [...new Set(found)];
}
