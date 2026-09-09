/**
 * Minimale XLSX-schrijver zonder dependencies: een zip (zonder compressie) met inline strings.
 * Genoeg voor de bestellijst en draait gewoon in een Cloudflare Worker.
 *
 *   buildWorkbook([{ name: 'AB INBEV', rows: [[{ v: 'Bestelbon:' }], ...] }]) -> Uint8Array
 *
 * Een cel is { v: waarde, f: formule, style: 'title'|'head'|'block'|'name'|'num'|'total' }.
 */

const enc = new TextEncoder();

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
// Excel aanvaardt geen stuurtekens in XML; die vallen weg.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => XML_ESC[c])
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const colName = (n) => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
export const cellRef = (col, row) => `${colName(col)}${row}`;

const STYLE = { plain: 0, title: 1, head: 2, block: 3, name: 4, num: 5, total: 6 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7E0FA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B1240"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs></styleSheet>`;

function sheetXml(rows, widths) {
  const cols = widths && widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const body = rows.map((cells, r) => {
    const row = r + 1;
    const written = (cells || []).map((cell, c) => {
      if (!cell) return '';
      const empty = cell.v === undefined || cell.v === null || cell.v === '';
      if (empty && !cell.f) return '';
      const ref = cellRef(c + 1, row);
      const style = ` s="${STYLE[cell.style] ?? 0}"`;
      if (cell.f) return `<c r="${ref}"${style}><f>${esc(cell.f)}</f></c>`;
      if (typeof cell.v === 'number') return `<c r="${ref}"${style}><v>${cell.v}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
    }).join('');
    return written ? `<row r="${row}">${written}</row>` : '';
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** Tabbladnaam: Excel laat geen []:*?/\ toe en maximaal 31 tekens. */
export const sheetName = (name, fallback = 'Blad') => {
  const clean = String(name || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return clean || fallback;
};

/* ---------- zip (opslag zonder compressie) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const u16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const push = (bytes) => { chunks.push(bytes); offset += bytes.length; };

  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const sum = crc32(data);
    const start = offset;
    push(join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(sum),
      u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes]));
    push(data);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(sum),
      u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(start), nameBytes]));
  }
  const centralStart = offset;
  for (const entry of central) push(entry);
  push(join([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(offset - centralStart), u32(centralStart), u16(0)]));
  return join(chunks);
}

/** sheets: [{ name, rows: cell[][], widths?: number[] }] */
export function buildWorkbook(sheets) {
  const used = new Set();
  const named = sheets.map((s, i) => {
    let name = sheetName(s.name, `Blad ${i + 1}`);
    let n = 2;
    while (used.has(name.toLowerCase())) name = sheetName(`${name.slice(0, 28)} ${n++}`);
    used.add(name.toLowerCase());
    return { ...s, name };
  });

  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ...named.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths)]),
  ];
  return zip(files);
}
