/**
 * GET    /api/pin   → { required, unlocked, access }  access = wat deze code mag
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

export const onRequestGet = handler(async ({ request, env }) => {
  const codes = await activeCodes(env, db(env));
  const current = codes.length ? await sessionCode(request, codes, env) : null;
  return json({ required: codes.length > 0, unlocked: !codes.length || !!current, access: describe(current) });
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
