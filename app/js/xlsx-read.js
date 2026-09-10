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

/* ---------- hulp bij het herkennen van koppen ---------- */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/* ---------- verkooprapport uit de kassa ---------- */

// De kolomkoppen van de kassa-export, in het Engels. Per kolom een paar schrijfwijzen, zodat een
// export met licht andere koppen ook nog gelezen wordt.
const VERKOOP_KOLOMMEN = {
  location: ['sales locations', 'sales location', 'location', 'toog', 'verkooppunt'],
  article: ['products', 'product', 'artikel', 'item'],
  qty: ['quantity (total)', 'quantity total', 'quantity - sold', 'quantity', 'aantal'],
  // let op: géén losse 'total' — de kassa-export heeft ook een kolom "Total" die leeg blijft
  revenue: ['eur (incl. tax)', 'eur (incl tax)', 'eur incl. tax', 'omzet', 'omzet incl. btw'],
};

/**
 * Leest een verkooprapport: één tabel met per regel een toog, een artikel en een aantal.
 * Geeft null als het blad er niet naar uitziet, zodat de import kan zeggen wat er mis is.
 */
export function interpretVerkoop(sheets) {
  for (const sheet of sheets) {
    const kolom = {};
    let koprij = 0;
    // de kopregel staat bovenaan, maar niet noodzakelijk op rij 1
    for (let r = 1; r <= Math.min(sheet.rows, 10) && !koprij; r++) {
      const gevonden = {};
      for (let c = 1; c <= sheet.cols; c++) {
        const kop = norm(sheet.grid.get(`${r},${c}`));
        if (!kop) continue;
        for (const [veld, namen] of Object.entries(VERKOOP_KOLOMMEN)) {
          if (gevonden[veld] === undefined && namen.includes(kop)) gevonden[veld] = c;
        }
      }
      if (gevonden.location && gevonden.article && gevonden.qty) {
        koprij = r;
        Object.assign(kolom, gevonden);
      }
    }
    if (!koprij) continue;

    const rows = [];
    const locaties = new Set();
    const artikelen = new Set();
    let totaalRegel = false;
    for (let r = koprij + 1; r <= sheet.rows; r++) {
      const locatie = String(sheet.grid.get(`${r},${kolom.location}`) ?? '').trim();
      const artikel = String(sheet.grid.get(`${r},${kolom.article}`) ?? '').trim();
      const aantal = Number(sheet.grid.get(`${r},${kolom.qty}`));
      // de eindregel van de export draagt enkel totalen, zonder toog of artikel
      if (!locatie || !artikel) { if (Number.isFinite(aantal)) totaalRegel = true; continue; }
      if (!Number.isFinite(aantal) || !aantal) continue;
      const omzet = kolom.revenue ? Number(sheet.grid.get(`${r},${kolom.revenue}`)) : NaN;
      rows.push({ location: locatie, article: artikel, qty: aantal, revenue: Number.isFinite(omzet) ? omzet : null });
      locaties.add(locatie);
      artikelen.add(artikel);
    }
    if (!rows.length) continue;

    return {
      sheet: sheet.name,
      rows,
      locations: [...locaties].sort(),
      articles: [...artikelen].sort(),
      items: rows.reduce((a, r) => a + r.qty, 0),
      revenue: rows.reduce((a, r) => a + (r.revenue || 0), 0),
      skippedTotal: totaalRegel,
    };
  }
  return null;
}
