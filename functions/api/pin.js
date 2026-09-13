/**
 * GET    /api/pin   → { required, unlocked, access, admin_login }
 *                     access      = wat deze code mag
 *                     admin_login = kan er met een Google-account aangemeld worden, en van welk domein
 * POST   /api/pin   { code } → cookie voor dertig dagen
 * DELETE /api/pin   → afmelden op dit toestel
 */
import { json, handler, db, body, HttpError } from '../_lib/http.js';
import { activeCodes, matchCode, sessionCode, grantCookie, clearCookie, tooManyAttempts } from '../_lib/pin.js';

const describe = (code) => code && ({
  label: code.label,
  role: code.role,
  company_id: code.company_id ?? null,
  company_name: code.company_name || null,
});

export const onRequestGet = handler(async ({ request, env, data }) => {
  const codes = await activeCodes(env, db(env));
  const current = codes.length ? await sessionCode(request, codes, env) : null;
  const beheerder = !!(data.user && data.user.admin_login);
  return json({
    required: codes.length > 0,
    unlocked: beheerder || !codes.length || !!current,
    access: beheerder ? { label: data.user.email, role: 'beheerder', company_id: null } : describe(current),
    admin_login: {
      enabled: beheerder || !!(data.user && data.user.admin_login_available),
      domain: (data.user && data.user.admin_domain) || '',
      signed_in: beheerder,
    },
  });
});

export const onRequestPost = handler(async ({ request, env }) => {
  const codes = await activeCodes(env, db(env));
  if (!codes.length) return json({ ok: true, required: false });

  const ip = request.headers.get('cf-connecting-ip') || 'onbekend';
  if (tooManyAttempts(ip)) throw new HttpError('Te veel pogingen. Probeer het over tien minuten opnieuw.', 429);

  const match = await matchCode(codes, ((await body(request)) || {}).code);
  if (!match) throw new HttpError('Die code klopt niet.', 401);
  return json({ ok: true, access: describe(match) }, 200, { 'set-cookie': await grantCookie(match.code, env) });
});

export const onRequestDelete = handler(async () => json({ ok: true }, 200, { 'set-cookie': clearCookie() }));
