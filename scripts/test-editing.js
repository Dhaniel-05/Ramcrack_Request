// Pruebas de las ayudas de edición del body (sangría automática, Tab, autocierre).
// Uso: node scripts/test-editing.js   (no necesita compilar: media/editing.js es JavaScript)
const assert = require('assert');
const E = require('../media/editing.js');

let n = 0;
const ok = (m) => console.log('  ✓', m, `(${++n})`);

/** Simula al usuario: texto con "|" = cursor (o "[" y "]" = selección). Devuelve el resultado en el mismo formato. */
function parse(t) {
  if (t.includes('«')) {
    const s = t.indexOf('«');
    const e = t.indexOf('»') - 1;
    return { v: t.replace('«', '').replace('»', ''), s, e };
  }
  const i = t.indexOf('|');
  return { v: t.replace('|', ''), s: i, e: i };
}
function show(r) {
  if (!r) return null;
  return r.start === r.end ? r.value.slice(0, r.start) + '|' + r.value.slice(r.start) : r.value.slice(0, r.start) + '«' + r.value.slice(r.start, r.end) + '»' + r.value.slice(r.end);
}
/** Teclea una secuencia de caracteres aplicando las reglas del editor (lo que no se intercepta se inserta tal cual). */
function type(initial, keys) {
  let { v, s, e } = parse(initial);
  for (const k of keys) {
    let r = null;
    if (k === '\n') r = E.enter(v, s, e);
    else if (k === '\t') r = E.tab(v, s, e, false);
    else if (k === '<BS>') r = E.backspace(v, s, e);
    else r = E.typeChar(v, s, e, k);
    if (r) { v = r.value; s = r.start; e = r.end; }
    else if (k === '<BS>') { if (s === e && s > 0) { v = v.slice(0, s - 1) + v.slice(e); s = e = s - 1; } else { v = v.slice(0, s) + v.slice(e); e = s; } }
    else { v = v.slice(0, s) + k + v.slice(e); s = e = s + k.length; }
  }
  return { v, s };
}

// ---- Enter ----
assert.strictEqual(show(E.enter(...Object.values(parse('{|}')).slice(0, 3))), '{\n  |\n}'); ok('Enter entre { y } abre un bloque: línea con sangría y la llave de cierre debajo');
assert.strictEqual(show(E.enter(...Object.values(parse('{\n  "a": 1,|')).slice(0, 3))), '{\n  "a": 1,\n  |'); ok('Enter mantiene la sangría de la línea anterior');
assert.strictEqual(show(E.enter(...Object.values(parse('{\n  "a": {|')).slice(0, 3))), '{\n  "a": {\n    |'); ok('Enter después de { añade un nivel');
assert.strictEqual(show(E.enter(...Object.values(parse('[|]')).slice(0, 3))), '[\n  |\n]'); ok('también con corchetes');
assert.strictEqual(show(E.enter(...Object.values(parse('    x|')).slice(0, 3))), '    x\n    |'); ok('conserva la sangría aunque no sea JSON');

// ---- Tab ----
assert.strictEqual(show(E.tab(...Object.values(parse('a|')).slice(0, 3), false)), 'a  |'); ok('Tab inserta 2 espacios');
assert.strictEqual(show(E.tab(...Object.values(parse('    a|')).slice(0, 3), true)), '  a|'); ok('Mayús+Tab quita un nivel de la línea');
assert.strictEqual(show(E.tab(...Object.values(parse('a|')).slice(0, 3), true)), 'a|'); ok('Mayús+Tab sin sangría no hace nada (y no rompe nada)');
assert.strictEqual(show(E.tab(...Object.values(parse('«a\nb\nc»')).slice(0, 3), false)), '  «a\n  b\n  c»'); ok('Tab con varias líneas seleccionadas las sangra todas y mantiene la selección');
assert.strictEqual(show(E.tab(...Object.values(parse('«  a\n  b»')).slice(0, 3), true)), '«a\nb»'); ok('Mayús+Tab con varias líneas las desangra todas');
assert.strictEqual(show(E.tab(...Object.values(parse('x\n«a\nb\n»c')).slice(0, 3), false)), 'x\n  «a\n  b\n»c'); ok('si la selección termina al inicio de una línea, esa línea no se sangra');

// ---- escribir sin tocar el ratón ----
let t = type('|', '{"a": {"b": [1, 2], "c": "x"}}'.split(''));
assert.strictEqual(t.v, '{"a": {"b": [1, 2], "c": "x"}}'); assert.strictEqual(JSON.parse(t.v).a.b[1], 2); ok('escribir un JSON de corrido con el autocierre no duplica llaves, corchetes ni comillas');
t = type('|', ['{', '\n', '"', 'a', '"', ':', ' ', '{', '\n', '"', 'b', '"', ':', ' ', '[', '\n', '1', ',', '\n', '2']);
assert.strictEqual(t.v, '{\n  "a": {\n    "b": [\n      1,\n      2\n    ]\n  }\n}'); ok('cuatro niveles quedan bien sangrados solo con teclear y Enter (sin ratón)');

// ---- autocierre ----
assert.strictEqual(show(E.typeChar(...Object.values(parse('|')).slice(0, 3), '{')), '{|}'); ok('{ escribe el par');
assert.strictEqual(show(E.typeChar(...Object.values(parse('{|}')).slice(0, 3), '}')), '{}|'); ok('escribir el cierre que ya está solo avanza');
assert.strictEqual(show(E.typeChar(...Object.values(parse('|')).slice(0, 3), '"')), '"|"'); ok('" escribe el par de comillas');
assert.strictEqual(show(E.typeChar(...Object.values(parse('"a|"')).slice(0, 3), '"')), '"a"|'); ok('escribir la comilla de cierre avanza sobre ella');
assert.strictEqual(E.typeChar(...Object.values(parse('ab|')).slice(0, 3), '"'), null); ok('una comilla pegada a una palabra no autocierra (apóstrofes, texto)');
assert.strictEqual(E.typeChar(...Object.values(parse('|abc')).slice(0, 3), '{'), null); ok('no se autocierra delante de texto');
assert.strictEqual(show(E.typeChar(...Object.values(parse('x«abc»y')).slice(0, 3), '"')), 'x"«abc»"y'); ok('con texto seleccionado, la comilla lo envuelve');
assert.strictEqual(E.typeChar(...Object.values(parse('|')).slice(0, 3), 'a'), null); ok('las letras normales no se interceptan');

// ---- retroceso ----
assert.strictEqual(show(E.backspace(...Object.values(parse('{|}')).slice(0, 3))), '|'); ok('Retroceso entre {} borra el par');
assert.strictEqual(show(E.backspace(...Object.values(parse('"|"')).slice(0, 3))), '|'); ok('Retroceso entre "" borra el par');
assert.strictEqual(E.backspace(...Object.values(parse('{a|}')).slice(0, 3)), null); ok('Retroceso con contenido dentro es el normal');

console.log(`\nOK: ${n} comprobaciones del editor pasaron`);
