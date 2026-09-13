/**
 * Beheerders die met hun Google-account aanmelden.
 *
 * GET    /api/admin/admins
 * POST   /api/admin/admins   { email, company_id, role, note }
 * DELETE /api/admin/admins?email=…
 *
 * Iedereen met een adres van het beheerdersdomein mag standaard alles. Wie hier in de lijst
 * staat, is beperkt tot wat er in zijn rij staat — bijvoorbeeld beheerder van één bedrijf.
 * Een rij verwijderen geeft die persoon dus wéér volledige toegang; dat staat ook zo op het
 * scherm, zodat niemand denkt dat "wissen" hetzelfde is als "buitenzetten".
 */
import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { guard, requireSuperAdmin } from './_guard.js';
import { ROLES } from '../../_lib/access.js';

const adres = (value) => {
  const email = text(value, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError('Geef een geldig e-mailadres.');
  return email;
};

const lijst = async (D) => {
  const rows = await D.prepare(
    `SELECT a.email, a.company_id, a.role, a.note, a.created_at, c.name AS company_name
       FROM admins a LEFT JOIN companies c ON c.id = a.company_id
      ORDER BY a.email`
  ).all();
  return rows.results || [];
};

export const onRequestGet = handler(async ({ env, data }) => {
  requireSuperAdmin(await guard(env, data));
  return json({ admins: await lijst(db(env)) });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  requireSuperAdmin(await guard(env, data));
  const D = db(env);
  const input = (await body(request)) || {};
  const email = adres(input.email);
  const role = ROLES.includes(input.role) ? input.role : 'beheerder';
  const companyId = int(input.company_id, null);

  if (companyId) {
    const bedrijf = await D.prepare('SELECT id FROM companies WHERE id = ?1').bind(companyId).first();
    if (!bedrijf) throw new HttpError('Onbekend bedrijf.', 404);
  }

  // Jezelf beperken terwijl je de enige beheerder bent, is een deur achter je dichttrekken.
  const ik = String((data.user && data.user.email) || '').toLowerCase();
  if (email === ik && companyId) {
    throw new HttpError(
      'Je zou jezelf tot één bedrijf beperken en daarna deze lijst niet meer kunnen aanpassen. '
      + 'Laat iemand anders dat doen, of gebruik de code met volledige toegang.', 400);
  }

  await D.prepare(
    `INSERT INTO admins (email, company_id, role, note) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(email) DO UPDATE SET company_id = excluded.company_id, role = excluded.role, note = excluded.note`
  ).bind(email, companyId, role, text(input.note, 200)).run();
  return json({ ok: true, admins: await lijst(D) }, 201);
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  requireSuperAdmin(await guard(env, data));
  const D = db(env);
  const email = adres(new URL(request.url).searchParams.get('email'));
  const res = await D.prepare('DELETE FROM admins WHERE lower(email) = ?1').bind(email).run();
  if (!res.meta.changes) throw new HttpError('Dat adres staat niet in de lijst.', 404);
  return json({
    ok: true,
    admins: await lijst(D),
    message: `${email} heeft nu weer volledige toegang, zoals elk adres van het beheerdersdomein.`,
  });
});
