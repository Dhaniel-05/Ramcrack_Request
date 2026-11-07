// Ayudas de edición para el cuadro del body (sangría automática, Tab, autocierre).
// Son funciones puras: reciben el texto y la selección y devuelven el resultado, o null si el
// navegador debe hacer lo normal. Se usan desde main.js y se prueban en Node (scripts/test-editing.js).
(function (root) {
  const INDENT = '  ';
  const PAIRS = { '{': '}', '[': ']', '"': '"' };
  const CLOSERS = new Set(['}', ']', '"']);

  const lineStart = (v, i) => v.lastIndexOf('\n', i - 1) + 1;
  const lineEnd = (v, i) => {
    const k = v.indexOf('\n', i);
    return k < 0 ? v.length : k;
  };
  const res = (value, start, end = start) => ({ value, start, end });

  /** Enter: conserva la sangría de la línea; añade un nivel tras { o [, y abre la llave en dos líneas. */
  function enter(v, s, e) {
    const ls = lineStart(v, s);
    const indent = /^[ \t]*/.exec(v.slice(ls, s))[0];
    const before = v.slice(ls, s).trimEnd().slice(-1);
    const after = v[e];
    const opens = before === '{' || before === '[';
    const closes = (before === '{' && after === '}') || (before === '[' && after === ']');
    if (closes) {
      const mid = '\n' + indent + INDENT;
      return res(v.slice(0, s) + mid + '\n' + indent + v.slice(e), s + mid.length);
    }
    const ins = '\n' + indent + (opens ? INDENT : '');
    return res(v.slice(0, s) + ins + v.slice(e), s + ins.length);
  }

  /** Tab / Mayús+Tab: inserta o quita sangría; con varias líneas seleccionadas, en todas ellas. */
  function tab(v, s, e, shift) {
    const multi = v.slice(s, e).includes('\n');
    if (!shift && !multi) {
      return res(v.slice(0, s) + INDENT + v.slice(e), s + INDENT.length);
    }
    const from = lineStart(v, s);
    // si la selección termina justo al inicio de una línea, esa línea no cuenta
    const to = e > s && v[e - 1] === '\n' ? e - 1 : e;
    const block = v.slice(from, lineEnd(v, to));
    const lines = block.split('\n');
    let firstDelta = 0;
    let total = 0;
    const out = lines.map((l, idx) => {
      let delta;
      let nl;
      if (shift) {
        const m = /^( {1,2}|\t)/.exec(l);
        nl = m ? l.slice(m[0].length) : l;
        delta = nl.length - l.length;
      } else {
        nl = INDENT + l;
        delta = INDENT.length;
      }
      if (idx === 0) firstDelta = delta;
      total += delta;
      return nl;
    });
    const text = v.slice(0, from) + out.join('\n') + v.slice(lineEnd(v, to));
    return res(text, Math.max(from, s + firstDelta), Math.max(from, e + total));
  }

  /** Autocierre de { [ " y salto sobre el cierre ya escrito. */
  function typeChar(v, s, e, ch) {
    if (s === e && CLOSERS.has(ch) && v[s] === ch) {
      return res(v, s + 1); // escribir el cierre que ya está: solo avanza
    }
    if (!(ch in PAIRS)) return null;
    if (s !== e) {
      // con texto seleccionado se envuelve
      return res(v.slice(0, s) + ch + v.slice(s, e) + PAIRS[ch] + v.slice(e), s + 1, e + 1);
    }
    if (ch === '"') {
      const prev = v[s - 1];
      if (prev && /[\w\\"]/.test(prev)) return null; // dentro o al final de una palabra / un escape
    } else {
      const next = v[s];
      if (next && /[\w"]/.test(next)) return null; // no cerrar delante de texto
    }
    return res(v.slice(0, s) + ch + PAIRS[ch] + v.slice(s), s + 1);
  }

  /** Retroceso entre un par vacío ({}, [], "") borra los dos. */
  function backspace(v, s, e) {
    if (s !== e || s === 0) return null;
    const a = v[s - 1];
    if (a in PAIRS && v[s] === PAIRS[a]) {
      return res(v.slice(0, s - 1) + v.slice(s + 1), s - 1);
    }
    return null;
  }

  const api = { enter, tab, typeChar, backspace, INDENT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RrEdit = api;
})(typeof window !== 'undefined' ? window : this);
