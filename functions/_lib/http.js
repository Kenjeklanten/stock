// Kleine helpers die alle API-functies delen.

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

export const bad = (message, status = 400) => json({ error: message }, status);

export async function body(request) {
  try { return await request.json(); } catch { return null; }
}

/** Verplicht een D1-binding; geeft een leesbare fout in plaats van "Cannot read properties of undefined". */
export function db(env) {
  if (!env.DB) throw new HttpError('Geen database gekoppeld. Voeg in Cloudflare Pages een D1-binding met de naam DB toe.', 500);
  return env.DB;
}

export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Wikkelt een handler: HttpError → nette JSON, onverwachte fout → 500 met melding. */
export const handler = (fn) => async (ctx) => {
  try {
    return await fn(ctx);
  } catch (err) {
    if (err instanceof HttpError) return bad(err.message, err.status);
    console.error(err);
    return json({ error: 'Er ging iets mis: ' + (err && err.message ? err.message : String(err)) }, 500);
  }
};

export const num = (v, fallback = null) => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

export const int = (v, fallback = null) => {
  const n = num(v, null);
  return n === null ? fallback : Math.round(n);
};

export const text = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const today = () => new Date().toISOString().slice(0, 10);

export const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
