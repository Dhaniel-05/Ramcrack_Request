import { randomUUID, randomInt } from 'crypto';

const NAMES = ['Ana', 'Luis', 'María', 'Carlos', 'Sofía', 'Jorge', 'Lucía', 'Pedro', 'Valentina', 'Andrés'];
const SURNAMES = ['García', 'Rodríguez', 'López', 'Martínez', 'Pérez', 'Gómez', 'Torres', 'Ramírez'];
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const pad = (n: number, l = 2) => String(n).padStart(l, '0');

function fmtDate(d: Date, format: string): string {
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    hh: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    fff: pad(d.getMilliseconds(), 3),
  };
  return format.replace(/YYYY|MM|DD|hh|mm|ss|fff/g, (t) => map[t]);
}

/** Separa argumentos por coma respetando comillas simples/dobles. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else {
        cur += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Variables de sistema estilo Thunder Client:
 * {{#guid}} {{#name}} {{#string}} {{#number}} {{#number, 1, 10}} {{#email}} {{#bool}}
 * {{#enum, a, b}} {{#date}} {{#date, 'X'}} {{#date, 'YYYY-MM-DD hh:mm:ss'}} {{#dateISO}}
 */
export function systemVar(expr: string): string | undefined {
  const parts = splitArgs(expr.slice(1));
  const name = parts[0];
  const args = parts.slice(1);
  switch (name) {
    case 'guid':
      return randomUUID();
    case 'name':
      return `${NAMES[randomInt(NAMES.length)]} ${SURNAMES[randomInt(SURNAMES.length)]}`;
    case 'string': {
      let s = '';
      for (let i = 0; i < 10; i++) {
        s += ALNUM[randomInt(ALNUM.length)];
      }
      return s;
    }
    case 'number': {
      const min = args[0] !== undefined ? parseInt(args[0], 10) : 1;
      const max = args[1] !== undefined ? parseInt(args[1], 10) : 1000000;
      if (Number.isNaN(min) || Number.isNaN(max) || max < min) {
        return undefined;
      }
      return String(randomInt(min, max + 1));
    }
    case 'email':
      return `user${randomInt(1000000)}@example.com`;
    case 'bool':
      return randomInt(2) === 0 ? 'true' : 'false';
    case 'enum':
      return args.length ? args[randomInt(args.length)] : undefined;
    case 'date': {
      const now = new Date();
      if (!args.length) {
        return String(now.getTime());
      }
      if (args[0] === 'X') {
        return String(Math.floor(now.getTime() / 1000));
      }
      return fmtDate(now, args[0]);
    }
    case 'dateISO':
      return new Date().toISOString();
    default:
      return undefined;
  }
}

/** Reemplaza {{variable}} y {{#sistema}}. Si no existe, deja el texto tal cual. */
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, expr: string) => {
    if (expr.startsWith('#')) {
      const v = systemVar(expr);
      return v === undefined ? match : v;
    }
    return Object.prototype.hasOwnProperty.call(vars, expr) ? vars[expr] : match;
  });
}
