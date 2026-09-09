/**
 * Minimale PDF-schrijver zonder dependencies (A4 staand, meerdere pagina's, standaard
 * Helvetica-fonts, WinAnsi-tekst). Genoeg voor tabellen zoals de bestelbon.
 */
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

export const A4 = { w: 595.28, h: 841.89 };

const MAP = { '€': 0x80, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '…': 0x85, 'œ': 0x9C, 'Œ': 0x8C, '™': 0x99 };
function encode(str) {
  const out = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 13 || cp === 9) { out.push(32); continue; }
    if ((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255)) out.push(cp);
    else if (MAP[ch]) out.push(MAP[ch]);
  }
  return out;
}
function widthOf(codes, size, bold) {
  const tbl = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const c of codes) w += (c >= 32 && c <= 126) ? tbl[c - 32] : 556;
  return (w / 1000) * size;
}
export const textWidth = (str, size, bold) => widthOf(encode(str), size, !!bold);

function pdfString(codes) {
  let s = '(';
  for (const c of codes) {
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}
const hex = (c) => { const n = parseInt(String(c).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' '); };

/** Kort een tekst af zodat hij binnen `maxW` past (met …). */
export function ellipsis(str, size, bold, maxW) {
  let s = String(str ?? '');
  if (textWidth(s, size, bold) <= maxW) return s;
  while (s.length > 1 && textWidth(s + '…', size, bold) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

export class Pdf {
  constructor(page = A4) {
    this.page = page;
    this.pages = [];
    this.ops = null;
    this.newPage();
  }
  newPage() { this.ops = []; this.pages.push(this.ops); return this; }
  get pageCount() { return this.pages.length; }
  fill(c) { this.ops.push(`${hex(c)} rg`); return this; }
  stroke(c) { this.ops.push(`${hex(c)} RG`); return this; }
  rect(x, y, w, h) { this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); return this; }
  line(x1, y1, x2, y2, w = 0.6) { this.ops.push(`${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`); return this; }
  text(str, x, y, size, opts = {}) {
    const codes = encode(str);
    if (!codes.length) return 0;
    const w = widthOf(codes, size, !!opts.bold);
    let tx = x;
    if (opts.align === 'center') tx = x - w / 2;
    else if (opts.align === 'right') tx = x - w;
    this.ops.push(`BT ${opts.bold ? '/F2' : '/F1'} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(codes)} Tj ET`);
    return w;
  }
  /** Vult per pagina de tekst "pagina x van y" in via een callback. */
  eachPage(fn) { this.pages.forEach((ops, i) => { const prev = this.ops; this.ops = ops; fn(i + 1, this.pages.length); this.ops = prev; }); return this; }

  build() {
    // Alles wordt als latin1 weggeschreven (één byte per teken); tekst buiten ASCII is in de
    // operatoren al octaal ge-escaped. Daardoor is tekenpositie == byte-positie voor de xref-tabel.
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const streams = this.pages.map((ops) => {
      const content = ops.join('\n');
      return add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    const pagesObj = objs.length + streams.length + 1;
    const pageObjs = streams.map((s) => add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${this.page.w} ${this.page.h}] /Contents ${s} 0 R ` +
      `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`));
    add(`<< /Type /Pages /Kids [${pageObjs.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageObjs.length} >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

    let out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const arr = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) arr[i] = out.charCodeAt(i) & 255;
    return arr;
  }
}
