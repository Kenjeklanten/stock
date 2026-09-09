import { json, handler, db, body, text, HttpError } from '../../_lib/http.js';
import { guard, requireSuperAdmin } from './_guard.js';

// De bedrijfsgegevens op de bestelbon staan bij het bedrijf zelf; hier blijft enkel wat globaal is.
const KEYS = ['csv_delimiter', 'pin'];

export const onRequestGet = handler(async ({ env }) => {
  const rows = await db(env).prepare('SELECT key, value FROM settings').all();
  return json({ settings: Object.fromEntries((rows.results || []).map((r) => [r.key, r.value])) });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  requireSuperAdmin(await guard(env, data));
  const D = db(env);
  const input = (await body(request)) || {};
  const statements = [];
  for (const key of KEYS) {
    if (input[key] === undefined) continue;
    let value = text(input[key], 300);
    if (key === 'csv_delimiter') value = [';', ',', '\t'].includes(input[key]) ? input[key] : ';';
    if (key === 'pin') {
      value = value.replace(/\s+/g, '');
      if (value && !/^\d{4,8}$/.test(value)) throw new HttpError('De toegangscode moet uit 4 tot 8 cijfers bestaan (of leeg zijn om ze uit te zetten).');
    }
    statements.push(D.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value));
  }
  if (!statements.length) throw new HttpError('Niets om op te slaan.');
  await D.batch(statements);
  const rows = await D.prepare('SELECT key, value FROM settings').all();
  return json({ settings: Object.fromEntries((rows.results || []).map((r) => [r.key, r.value])) });
});
