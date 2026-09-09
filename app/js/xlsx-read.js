/**
 * Een .xlsx inlezen in de browser, zonder bibliotheek: de zip uitpakken met
 * DecompressionStream en de bladen met reguliere expressies uitlezen.
 *
 *   const sheets = await readWorkbook(file);       // [{ name, grid: Map('r,c' -> waarde), rows, cols }]
 *   const lijst  = interpretBestellijst(sheets);   // leveranciers, locaties, producten
 *
 * Draait ook in Node (voor de testen): er wordt niets uit de DOM gebruikt.
 */

const dec = new TextDecoder();

/* ---------- zip ---------- */

async function inflate(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error(`Onbekende compressie in het bestand (methode ${method}).`);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // end of central directory: achteraan zoeken naar de handtekening
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Dit lijkt geen geldig xlsx-bestand (geen zip).');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const localNameLen = view.getUint16(localAt + 26, true);
    const localExtraLen = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + localNameLen + localExtraLen;
    files.set(name, { method, data: bytes.subarray(start, start + compressed) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------- xml ---------- */

const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

const textOf = (xml) => unescapeXml((xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
  .map((t) => t.replace(/<[^>]+>/g, '')).join(''));

const colIndex = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

/** Leest alle bladen; elke cel komt in een Map met sleutel "rij,kolom". */
export async function readWorkbook(source) {
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const files = await unzip(buffer);
  const read = async (name) => {
    const entry = files.get(name);
    return entry ? dec.decode(await inflate(entry.data, entry.method)) : '';
  };

  const shared = [];
  const sharedXml = await read('xl/sharedStrings.xml');
  for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(textOf(si));

  const relsXml = await read('xl/_rels/workbook.xml.rels');
  const rels = new Map();
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    rels.set(m[1], m[2].replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const workbookXml = await read('xl/workbook.xml');
  const sheets = [];
  let fallback = 0;
  for (const m of workbookXml.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*?(?:r:id="([^"]+)")?[^>]*\/>/g)) {
    fallback += 1;
    const target = (m[2] && rels.get(m[2])) || `worksheets/sheet${fallback}.xml`;
    const xml = await read(`xl/${target}`);
    if (!xml) continue;

    const grid = new Map();
    let maxRow = 0;
    let maxCol = 0;
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row = Number(rm[1]);
      for (const cm of (rm[2] || '').matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = colIndex(cm[1]);
        const attrs = cm[2] || '';
        const body = cm[3] || '';
        if (!body) continue;
        const type = (attrs.match(/t="([^"]+)"/) || [])[1];
        let value;
        if (type === 's') {
          const v = body.match(/<v>([\s\S]*?)<\/v>/);
          value = v ? shared[Number(v[1])] : '';
        } else if (type === 'inlineStr') {
          value = textOf(body);
        } else if (type === 'str') {
          const v = body.match(/<v>([\s\S]*?)<\/v>/);
          value = v ? unescapeXml(v[1]) : '';
        } else {
          const v = body.match(/<v>([\s\S]*?)<\/v>/);
          if (!v) continue;
          const number = Number(v[1]);
          value = Number.isFinite(number) ? number : unescapeXml(v[1]);
        }
        if (value === '' || value === undefined || value === null) continue;
        grid.set(`${row},${col}`, typeof value === 'string' ? value.trim() : value);
        if (row > maxRow) maxRow = row;
        if (col > maxCol) maxCol = col;
      }
    }
    sheets.push({ name: unescapeXml(m[1]), grid, rows: maxRow, cols: maxCol });
  }
  return sheets;
}

/* ---------- betekenis geven aan de bestellijst ---------- */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

const SKIP_A = new Set(['artikel', 'bestelbon', 'bestelbon:', 'extra artikel', '']);

/**
 * Leest bladen in de vorm van de bestellijst: één blad per leverancier, in de kopregel de
 * locaties (laatste kolom "Totaal"), daaronder de producten met per locatie een getal.
 * Blokken met een naam in kolom A (bv. PET, EXTRA) worden categorieën.
 *
 * Geeft { suppliers: [{ name, locations, products: [{ name, category, values }] }], warnings }
 */
export function interpretBestellijst(sheets) {
  const warnings = [];
  const suppliers = [];

  for (const sheet of sheets) {
    const cell = (r, c) => sheet.grid.get(`${r},${c}`);
    const textCells = (r) => {
      const out = [];
      for (let c = 2; c <= sheet.cols; c++) {
        const v = cell(r, c);
        if (typeof v === 'string' && v) out.push({ name: v, col: c });
      }
      return out;
    };
    const hasNumbers = (r) => {
      for (let c = 2; c <= sheet.cols; c++) if (typeof cell(r, c) === 'number') return true;
      return false;
    };

    const locations = [];      // { name, col }
    const products = [];
    let category = '';
    let seenHeader = false;

    for (let r = 1; r <= sheet.rows; r++) {
      const first = cell(r, 1);
      const texts = textCells(r);
      const isHeader = texts.length >= 2 && !hasNumbers(r) &&
        (!seenHeader || texts.some((t) => locations.some((l) => norm(l.name) === norm(t.name))));

      if (isHeader) {
        const cols = texts.filter((t) => norm(t.name) !== 'totaal');
        for (const t of cols) {
          const known = locations.find((l) => l.col === t.col);
          if (known) known.name = t.name;
          else locations.push({ ...t });
        }
        seenHeader = true;
        category = typeof first === 'string' && !SKIP_A.has(norm(first)) ? first : '';

        // De rij eronder kan onderverdelingen bevatten (bv. "Noord sector" → La Cantine /
        // Zaal Raymond). Die horen bij de kolomnaam; kolom A blijft dan een gewoon product.
        const below = textCells(r + 1);
        const isSubLabels = below.length > 0 && below.length < locations.length && !hasNumbers(r + 1) &&
          below.every((t) => locations.some((l) => l.col === t.col && norm(l.name) !== norm(t.name)));
        if (isSubLabels) {
          for (const t of below) {
            const loc = locations.find((l) => l.col === t.col);
            if (loc && !norm(loc.name).endsWith(norm(t.name))) loc.name = `${loc.name} ${t.name}`.trim();
          }
        }
        continue;
      }

      if (typeof first !== 'string' || !first || SKIP_A.has(norm(first))) continue;
      if (!seenHeader) continue;                      // producten vóór de kopregel bestaan niet
      if (!/[a-z0-9]/i.test(first)) {                 // losse tekens zoals "(" zijn geen product
        warnings.push(`Tabblad "${sheet.name}", rij ${r}: "${first}" ziet er niet uit als een product — overgeslagen.`);
        continue;
      }
      if (products.some((p) => norm(p.name) === norm(first))) {
        warnings.push(`Tabblad "${sheet.name}": "${first}" staat er twee keer in — de tweede is overgeslagen.`);
        continue;
      }

      const values = {};
      for (const loc of locations) {
        const v = cell(r, loc.col);
        if (typeof v === 'number') values[loc.name] = v;
      }
      products.push({ name: first, category, values });
    }

    if (!locations.length || !products.length) {
      warnings.push(`Tabblad "${sheet.name}": geen ${locations.length ? 'producten' : 'kopregel met locaties'} gevonden — overgeslagen.`);
      continue;
    }
    suppliers.push({ name: sheet.name, locations: locations.map((l) => l.name), products });
  }

  return { suppliers, warnings };
}
