/**
 * GET    /api/pin   → { required, unlocked }
 * POST   /api/pin   { code } → cookie voor dertig dagen
 * DELETE /api/pin   → afmelden op dit toestel
 */
import { json, handler, db, body, HttpError } from '../_lib/http.js';
import { activePin, unlocked, grantCookie, clearCookie, tooManyAttempts } from '../_lib/pin.js';

export const onRequestGet = handler(async ({ request, env }) => {
  const pin = await activePin(env, db(env));
  return json({ required: !!pin, unlocked: !pin || await unlocked(request, pin, env) });
});

export const onRequestPost = handler(async ({ request, env }) => {
  const pin = await activePin(env, db(env));
  if (!pin) return json({ ok: true, required: false });

  const ip = request.headers.get('cf-connecting-ip') || 'onbekend';
  if (tooManyAttempts(ip)) throw new HttpError('Te veel pogingen. Probeer het over tien minuten opnieuw.', 429);

  const given = String(((await body(request)) || {}).code || '').trim();
  if (given !== pin) throw new HttpError('Die code klopt niet.', 401);
  return json({ ok: true }, 200, { 'set-cookie': await grantCookie(pin, env) });
});

export const onRequestDelete = handler(async () => json({ ok: true }, 200, { 'set-cookie': clearCookie() }));
