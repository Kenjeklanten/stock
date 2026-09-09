// CSV zoals Excel (BE/NL) het verwacht: puntkomma als scheidingsteken, komma als decimaalteken,
// UTF-8 met BOM zodat accenten meteen goed staan.

export function csvValue(v, delimiter) {
  const s = v === null || v === undefined ? '' : String(v);
  return /["\n\r]|^\s|\s$/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows, delimiter = ';') {
  const line = (arr) => arr.map((v) => csvValue(v, delimiter)).join(delimiter);
  return '\ufeff' + [line(headers), ...rows.map(line)].join('\r\n') + '\r\n';
}

/** Bestandsnaam-vriendelijke tekst. */
export const slug = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'bestelling';

/** Splitst een CSV-tekst in rijen; herkent ; , of tab als scheidingsteken. */
export function parseCsv(input) {
  const raw = String(input || '').replace(/^\ufeff/, '');
  const firstLine = raw.split(/\r?\n/, 1)[0] || '';
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts[ch] !== undefined) counts[ch]++;
  }
  const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
