/**
 * Wie mag welk bedrijf gebruiken.
 *
 * GET    /api/admin/members[?company_id=]   de leden (van dat bedrijf, of van alles wat je mag zien)
 * POST   /api/admin/members                 { company_id, email, role: 'teller' | 'beheerder' }
 * DELETE /api/admin/members?company_id=&email=
 *
 * Zolang er nog geen enkel lid bestaat, mag iedereen met een Access-sessie alles. Voeg je het
 * eerste lid toe, dan geldt de lijst — daarom is het verstandig om jezelf als eerste toe te
 * voegen, of in ADMIN_EMAILS te staan (hoofdbeheerder, mag altijd overal aan).
 */
import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { guard, requireCompany } from './_guard.js';
import { ROLES, visibleCompanies } from '../../_lib/access.js';

const address = (value) => {
  const email = text(value, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError('Geef een geldig e-mailadres.');
  return email;
};

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const scope = await guard(env, data);
  const companyId = int(new URL(request.url).searchParams.get('company_id'), null);

  // `configured` zegt of de ledenlijst al meetelt — dat hangt van de tabel af, niet van wie kijkt.
  const total = await D.prepare('SELECT COUNT(*) AS n FROM members').first();
  const configured = !!(total && total.n > 0);

  if (companyId) {
    requireCompany(scope, companyId);
    const rows = await D.prepare(
      'SELECT email, company_id, role, created_at FROM members WHERE company_id = ?1 ORDER BY role, email'
    ).bind(companyId).all();
    return json({ members: rows.results || [], configured });
  }

  const [rows, companies] = await Promise.all([
    D.prepare('SELECT email, company_id, role, created_at FROM members ORDER BY company_id, role, email').all(),
    D.prepare('SELECT id, name FROM companies').all(),
  ]);
  const allowed = new Set(visibleCompanies(scope, companies.results || []).map((c) => c.id));
  return json({
    members: (rows.results || []).filter((m) => allowed.has(m.company_id)),
    configured,
  });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const scope = await guard(env, data);
  const companyId = requireCompany(scope, int(input.company_id, null), { manage: true });
  const email = address(input.email);
  const role = ROLES.includes(input.role) ? input.role : 'teller';

  const company = await D.prepare('SELECT id FROM companies WHERE id = ?1').bind(companyId).first();
  if (!company) throw new HttpError('Onbekend bedrijf.', 404);

  const before = await D.prepare('SELECT COUNT(*) AS n FROM members').first();
  const first = !before || before.n === 0;
  const me = String((data.user && data.user.email) || '').toLowerCase();
  const listSet = !!(data.user && data.user.admin_list_set);

  // Vanaf het eerste lid telt de lijst. Wie hem instelt zonder in ADMIN_EMAILS te staan en
  // zonder zichzelf toe te voegen, zou zichzelf buitensluiten — dus voegen we die persoon
  // meteen als beheerder toe. Is er geen aangemeld adres, dan gaat het niet en stoppen we.
  if (first && !listSet && me !== email) {
    if (!me) {
      throw new HttpError(
        'Er is geen aangemeld adres bekend, dus je zou jezelf buitensluiten zodra deze lijst begint. ' +
        'Zet eerst ADMIN_EMAILS op het Pages-project, of voeg jezelf als eerste toe.', 400);
    }
  }

  const statements = [D.prepare(
    `INSERT INTO members (email, company_id, role) VALUES (?1, ?2, ?3)
     ON CONFLICT(email, company_id) DO UPDATE SET role = excluded.role`
  ).bind(email, companyId, role)];
  let message;
  if (first && !listSet && me && me !== email) {
    statements.push(D.prepare(
      `INSERT INTO members (email, company_id, role) VALUES (?1, ?2, 'beheerder')
       ON CONFLICT(email, company_id) DO UPDATE SET role = 'beheerder'`
    ).bind(me, companyId));
    message = `Vanaf nu telt deze lijst. Je bent zelf als beheerder toegevoegd (${me}), anders zou je geen toegang meer hebben.`;
  }
  await D.batch(statements);
  return json({ ok: true, email, company_id: companyId, role, ...(message ? { message } : {}) }, 201);
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const companyId = requireCompany(await guard(env, data), int(url.searchParams.get('company_id'), null), { manage: true });
  const email = address(url.searchParams.get('email'));
  const res = await D.prepare('DELETE FROM members WHERE email = ?1 AND company_id = ?2').bind(email, companyId).run();
  if (!res.meta.changes) throw new HttpError('Dat lid staat er niet bij.', 404);

  const left = await D.prepare('SELECT COUNT(*) AS n FROM members').first();
  return json({
    ok: true,
    ...(left && left.n === 0
      ? { message: 'Dit was het laatste lid. De ledenlijst telt nu niet meer mee: enkel ADMIN_EMAILS bepaalt nog wie beheerder is, en staat die lijst ook leeg, dan mag iedereen met toegang weer alles.' }
      : {}),
  });
});
