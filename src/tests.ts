import { Assertion, CookieInfo, TestResult } from './types';

export interface ResponseView {
  status: number;
  timeMs: number;
  headers: [string, string][];
  cookies: CookieInfo[];
  body: string;
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Acceso por ruta: data.items[0].id  |  json.data.id  |  $.data.id  |  lista.length */
export function getByPath(data: unknown, path: string): unknown {
  const p = path
    .trim()
    .replace(/^\$(\.|$)/, '')
    .replace(/^json(\.|$)/, '');
  if (!p) {
    return data;
  }
  const tokens: (string | number)[] = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    tokens.push(m[2] !== undefined ? Number(m[2]) : m[1]);
  }
  let cur: any = data;
  for (const t of tokens) {
    if (cur === null || cur === undefined) {
      return undefined;
    }
    if (t === 'length' && (Array.isArray(cur) || typeof cur === 'string')) {
      cur = cur.length;
      continue;
    }
    cur = cur[t as any];
  }
  return cur;
}

function toStr(v: unknown): string {
  if (v === undefined) {
    return '';
  }
  if (v === null) {
    return 'null';
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

const isNum = (s: string) => s.trim() !== '' && !Number.isNaN(Number(s));

function evalOp(op: string, actual: unknown, expected: string): boolean {
  const a = toStr(actual);
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'notexists':
      return actual === undefined || actual === null;
    case 'eq':
      return isNum(a) && isNum(expected) ? Number(a) === Number(expected) : a === expected.trim();
    case 'neq':
      return isNum(a) && isNum(expected) ? Number(a) !== Number(expected) : a !== expected.trim();
    case 'contains':
      return a.includes(expected);
    case 'notcontains':
      return !a.includes(expected);
    case 'gt':
      return Number(a) > Number(expected);
    case 'gte':
      return Number(a) >= Number(expected);
    case 'lt':
      return Number(a) < Number(expected);
    case 'lte':
      return Number(a) <= Number(expected);
    case 'regex':
      try {
        return new RegExp(expected).test(a);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

const OP_LABEL: Record<string, string> = {
  eq: '=',
  neq: '≠',
  contains: 'contiene',
  notcontains: 'no contiene',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  exists: 'existe',
  notexists: 'no existe',
  regex: 'coincide con',
};

export function runAssertions(
  assertions: Assertion[],
  res: ResponseView,
  sub: (s: string) => string
): TestResult[] {
  const json = parseJson(res.body);
  const results: TestResult[] = [];
  for (const a of assertions) {
    if (!a.enabled) {
      continue;
    }
    const key = sub(a.key || '').trim();
    const expected = sub(a.value || '');
    let actual: unknown;
    let label: string;
    switch (a.source) {
      case 'status':
        actual = res.status;
        label = 'Status code';
        break;
      case 'time':
        actual = res.timeMs;
        label = 'Tiempo de respuesta (ms)';
        break;
      case 'header':
        actual = res.headers.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
        label = `Header ${key}`;
        break;
      case 'json':
        actual = json === undefined ? undefined : getByPath(json, key);
        label = `JSON ${key}`;
        break;
      default:
        actual = res.body;
        label = 'Body';
    }
    const pass = evalOp(a.op, actual, expected);
    const needsValue = a.op !== 'exists' && a.op !== 'notexists';
    results.push({
      name: `${label} ${OP_LABEL[a.op] ?? a.op}${needsValue ? ' ' + expected : ''}`,
      pass,
      detail: `valor real: ${actual === undefined ? '(no existe)' : toStr(actual).slice(0, 120)}`,
    });
  }
  return results;
}

export type Extracted = { kind: 'value'; value: string } | { kind: 'delete' } | { kind: 'missing' };

/** Obtiene el valor de la respuesta según la fuente de "Set Env Variable". */
export function extractSource(
  source: string,
  res: ResponseView,
  sub: (s: string) => string
): Extracted {
  const s = source.trim();
  if (s === 'delete') {
    return { kind: 'delete' };
  }
  if (s === 'null') {
    return { kind: 'value', value: '' };
  }
  if (s === 'text') {
    return { kind: 'value', value: res.body };
  }
  if (/^json(\.|$)/.test(s)) {
    const json = parseJson(res.body);
    const v = json === undefined ? undefined : getByPath(json, s);
    return v === undefined ? { kind: 'missing' } : { kind: 'value', value: toStr(v) };
  }
  const h = /^header\.(.+)$/.exec(s);
  if (h) {
    const v = res.headers.find(([k]) => k.toLowerCase() === h[1].toLowerCase())?.[1];
    return v === undefined ? { kind: 'missing' } : { kind: 'value', value: v };
  }
  const c = /^cookie\.(.+)$/.exec(s);
  if (c) {
    const v = res.cookies.find((x) => x.name === c[1])?.value;
    return v === undefined ? { kind: 'missing' } : { kind: 'value', value: v };
  }
  return { kind: 'value', value: sub(source) };
}

/** "{{token}}" | "{{token, global}}" */
export function parseTarget(target: string): { name: string; scope: 'active' | 'global' } | undefined {
  const m = /^\s*\{\{\s*([^,{}]+?)\s*(?:,\s*(\w+)\s*)?\}\}\s*$/.exec(target);
  if (!m) {
    return undefined;
  }
  return { name: m[1], scope: m[2] === 'global' ? 'global' : 'active' };
}
