import { randomUUID } from 'crypto';
import { ApiRequest, Collection, Folder } from './types';

export function newRequestTemplate(name: string): ApiRequest {
  return {
    id: randomUUID(),
    name,
    method: 'GET',
    url: '',
    description: '',
    headers: [],
    body: { type: 'none', content: '', formurl: [], form: [], gqlQuery: '', gqlVars: '', file: '' },
    auth: { type: 'none', token: '', username: '', password: '', keyName: '', keyValue: '', keyIn: 'header' },
    tests: { assertions: [], setVars: [] },
    preRun: '',
  };
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Normaliza una carpeta (y todo lo que contiene) de forma recursiva. */
export function normalizeFolder(f: any): Folder {
  return {
    ...(f && typeof f === 'object' ? f : {}),
    id: f?.id ?? randomUUID(),
    name: f?.name ?? 'Carpeta',
    requests: asArray(f?.requests).map(normalizeRequest),
    folders: asArray(f?.folders).map(normalizeFolder),
  };
}

/**
 * Normaliza una colección. Los archivos de la 0.2.x no tienen `folders`: se completa con [].
 * Conserva campos desconocidos para no perder datos de versiones futuras.
 */
export function normalizeCollection(c: any): Collection {
  return {
    ...(c && typeof c === 'object' ? c : {}),
    id: c?.id ?? randomUUID(),
    name: c?.name ?? 'Colección',
    requests: asArray(c?.requests).map(normalizeRequest),
    folders: asArray(c?.folders).map(normalizeFolder),
  };
}

/** Completa campos que falten (datos guardados por versiones anteriores o importados). */
export function normalizeRequest(r: any): ApiRequest {
  const t = newRequestTemplate(r?.name ?? 'Petición');
  const body = { ...t.body, ...(r?.body || {}) };
  // Versión 0.0.x: "form" era texto clave=valor por línea -> ahora es "formurl"
  if (r?.body?.type === 'form' && !Array.isArray(r.body.form)) {
    body.type = 'formurl';
    body.formurl = String(r.body.content || '')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        const i = l.indexOf('=');
        return { enabled: true, key: (i < 0 ? l : l.slice(0, i)).trim(), value: i < 0 ? '' : l.slice(i + 1).trim() };
      });
    body.content = '';
  }
  body.formurl = Array.isArray(body.formurl) ? body.formurl : [];
  body.form = Array.isArray(body.form) ? body.form : [];
  return {
    ...t,
    ...r,
    id: r?.id ?? t.id,
    description: r?.description ?? '',
    headers: Array.isArray(r?.headers) ? r.headers : [],
    body,
    auth: { ...t.auth, ...(r?.auth || {}) },
    tests: {
      assertions: Array.isArray(r?.tests?.assertions) ? r.tests.assertions : [],
      setVars: Array.isArray(r?.tests?.setVars) ? r.tests.setVars : [],
    },
    preRun: r?.preRun ?? '',
  };
}
