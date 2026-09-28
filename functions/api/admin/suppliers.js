import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { guard, requireCompany, requireRowCompany } from './_guard.js';
import { nummer } from '../../_lib/whatsapp.js';

/** Een WhatsApp-nummer wordt bewaard in de vorm die WhatsApp verwacht, of helemaal niet. */
function telefoon(v) {
  const ruw = String(v ?? '').trim();
  if (!ruw) return null;
  const n = nummer(ruw);
  if (!n) throw new HttpError(`"${ruw}" is geen geldig telefoonnummer. Bijvoorbeeld: 0479 21 64 33.`);
  return n;
}

/** Het eigen bericht van een leverancier mag regeleindes houden. */
const bericht = (v) => {
  const t = String(v ?? '').replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, 1500);
  if (t && !t.includes('{regels}')) {
    throw new HttpError('Zet {regels} in het bericht, anders staat de bestelling er niet in.');
  }
  return t || null;
};

/** GET /api/admin/suppliers?company_id= */
export const onRequestGet = handler(async ({ request, env }) => {
  const companyId = int(new URL(request.url).searchParams.get('company_id'), null);
  const rows = companyId
    ? await db(env).prepare('SELECT * FROM suppliers WHERE company_id = ?1 ORDER BY sort, name').bind(companyId).all()
    : await db(env).prepare('SELECT * FROM suppliers ORDER BY company_id, sort, name').all();
  return json({ suppliers: rows.results || [] });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  const input = (await body(request)) || {};
  const companyId = int(input.company_id, null);
  const name = text(input.name, 80);
  requireCompany(await guard(env, data), companyId, { manage: true });
  if (!name) throw new HttpError('Geef de leverancier een naam.');
  try {
    const res = await db(env).prepare(
      `INSERT INTO suppliers (company_id, name, sort, whatsapp, whatsapp_active, whatsapp_template)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(companyId, name, int(input.sort, 0), telefoon(input.whatsapp),
           input.whatsapp_active === true || input.whatsapp_active === 1 ? 1 : 0,
           bericht(input.whatsapp_template)).run();
    return json({ id: res.meta.last_row_id }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError('Dit bedrijf heeft al een leverancier met die naam.', 409);
    if (String(err.message).includes('FOREIGN KEY')) throw new HttpError('Onbekend bedrijf.', 400);
    throw err;
  }
});

export const onRequestPut = handler(async ({ request, env, data }) => {
  const input = (await body(request)) || {};
  const id = int(input.id, null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  await requireRowCompany(env, data, 'suppliers', id);
  const tel = telefoon(input.whatsapp);
  const res = await db(env).prepare(
    `UPDATE suppliers SET name = ?2, sort = ?3, whatsapp = ?4, whatsapp_active = ?5, whatsapp_template = ?6
      WHERE id = ?1`
  ).bind(id, text(input.name, 80), int(input.sort, 0), tel,
         // zonder nummer valt er niets te versturen; de schakelaar gaat dan mee uit
         tel && (input.whatsapp_active === true || input.whatsapp_active === 1) ? 1 : 0,
         bericht(input.whatsapp_template)).run();
  if (!res.meta.changes) throw new HttpError('Leverancier niet gevonden.', 404);
  return json({ ok: true });
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  const D = db(env);
  const id = int(new URL(request.url).searchParams.get('id'), null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  await requireRowCompany(env, data, 'suppliers', id);
  // De producten van deze leverancier blijven bestaan; ze komen dan onder "Zonder leverancier".
  const used = await D.prepare('SELECT COUNT(*) AS n FROM products WHERE supplier_id = ?1').bind(id).first();
  await D.prepare('DELETE FROM suppliers WHERE id = ?1').bind(id).run();
  if (used && used.n > 0) {
    return json({ ok: true, message: `Leverancier verwijderd; ${used.n} producten staan nu zonder leverancier.` });
  }
  return json({ ok: true });
});
