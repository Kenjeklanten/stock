/**
 * Toegangscodes beheren.
 *
 * GET    /api/admin/codes                de codes (zonder de cijfers zelf te tonen behalve aan
 *                                        wie ze mag beheren — zie hieronder)
 * POST   /api/admin/codes                { code, label, role, company_id }
 * DELETE /api/admin/codes?code=1234
 *
 * Enkel wie volledige toegang heeft komt hier binnen. Er blijft altijd minstens één code met
 * volledige toegang over: de laatste laat zich niet verwijderen, anders kan niemand nog beheren.
 * (Wie zich toch buitensluit, zet APP_PIN op het Pages-project.)
 */
import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { guard, requireSuperAdmin } from './_guard.js';
import { ROLES } from '../../_lib/access.js';

const digits = (value) => {
  const code = String(value ?? '').replace(/\s+/g, '');
  if (!/^\d{4,8}$/.test(code)) throw new HttpError('Een toegangscode bestaat uit 4 tot 8 cijfers.');
  return code;
};

const list = async (D) => {
  const rows = await D.prepare(
    `SELECT a.code, a.label, a.role, a.company_id, a.active, a.created_at, c.name AS company_name
       FROM access_codes a LEFT JOIN companies c ON c.id = a.company_id
      ORDER BY a.company_id IS NOT NULL, a.label`
  ).all();
  return rows.results || [];
};

export const onRequestGet = handler(async ({ env, data }) => {
  requireSuperAdmin(await guard(env, data));
  return json({ codes: await list(db(env)) });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  requireSuperAdmin(await guard(env, data));
  const D = db(env);
  const input = (await body(request)) || {};
  const code = digits(input.code);
  const label = text(input.label, 80) || (input.company_id ? 'Tellen' : 'Volledige toegang');
  const role = ROLES.includes(input.role) ? input.role : 'teller';
  const companyId = int(input.company_id, null);

  if (companyId) {
    const company = await D.prepare('SELECT id FROM companies WHERE id = ?1').bind(companyId).first();
    if (!company) throw new HttpError('Onbekend bedrijf.', 404);
  }
  await D.prepare(
    `INSERT INTO access_codes (code, label, role, company_id, active) VALUES (?1, ?2, ?3, ?4, 1)
     ON CONFLICT(code) DO UPDATE SET label = excluded.label, role = excluded.role,
       company_id = excluded.company_id, active = 1`
  ).bind(code, label, role, companyId).run();
  return json({ ok: true, codes: await list(D) }, 201);
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  requireSuperAdmin(await guard(env, data));
  const D = db(env);
  const code = digits(new URL(request.url).searchParams.get('code'));

  const row = await D.prepare('SELECT code, role, company_id FROM access_codes WHERE code = ?1').bind(code).first();
  if (!row) throw new HttpError('Die code bestaat niet.', 404);
  if (!row.company_id && row.role === 'beheerder') {
    const others = await D.prepare(
      "SELECT COUNT(*) AS n FROM access_codes WHERE active = 1 AND company_id IS NULL AND role = 'beheerder' AND code <> ?1"
    ).bind(code).first();
    if (!others || !others.n) {
      throw new HttpError('Dit is de laatste code met volledige toegang. Maak eerst een nieuwe aan, anders kan niemand de tool nog beheren.', 409);
    }
  }
  await D.prepare('DELETE FROM access_codes WHERE code = ?1').bind(code).run();
  return json({ ok: true, codes: await list(D) });
});
