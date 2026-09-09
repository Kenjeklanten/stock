import { json, handler, db, body, text, HttpError } from '../../_lib/http.js';
import { guard, requireSuperAdmin } from './_guard.js';

// De bedrijfsgegevens op de bestelbon staan bij het bedrijf zelf; hier blijft enkel wat globaal is.
const KEYS = ['csv_delimiter'];

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
    const value = key === 'csv_delimiter'
      ? ([';', ',', '\t'].includes(input[key]) ? input[key] : ';')
      : text(input[key], 300);
    statements.push(D.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value));
  }
  if (!statements.length) throw new HttpError('Niets om op te slaan.');
  await D.batch(statements);
  const rows = await D.prepare('SELECT key, value FROM settings').all();
  return json({ settings: Object.fromEntries((rows.results || []).map((r) => [r.key, r.value])) });
});
