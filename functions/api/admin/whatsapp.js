/**
 * De WhatsApp-instellingen van een bedrijf.
 *
 * GET /api/admin/whatsapp?company_id=…   het bericht, de stand van de integratie en het logboek
 * PUT /api/admin/whatsapp  { company_id, template }
 *
 * Het bericht per leverancier en de schakelaars per leverancier en locatie staan bij die rijen
 * zelf (/api/admin/suppliers en /api/admin/locations); hier staat enkel wat voor het hele
 * bedrijf geldt.
 */
import { json, handler, db, body, int, HttpError } from '../../_lib/http.js';
import { guard, requireCompany } from './_guard.js';
import {
  TEMPLATE_STANDAARD, PLAATSHOUDERS, templateSleutel, ingesteld, templateNaam,
} from '../../_lib/whatsapp.js';

/** Een bericht mag regeleindes houden; text() uit http.js plet die en is hier dus niet bruikbaar. */
const berichtTekst = (v) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, 1500);

const logboek = async (D, companyId) => {
  const rows = await D.prepare(
    `SELECT id, count_id, supplier_name, location_name, to_number, status, detail, sent_at, sent_by,
            substr(body, 1, 400) AS body
       FROM whatsapp_messages WHERE company_id = ?1
      ORDER BY sent_at DESC, id DESC LIMIT 30`
  ).bind(companyId).all();
  return rows.results || [];
};

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const companyId = int(new URL(request.url).searchParams.get('company_id'), null);
  if (!companyId) throw new HttpError('Geen bedrijf gekozen.');
  requireCompany(await guard(env, data), companyId, { manage: true });

  const rij = await D.prepare('SELECT value FROM settings WHERE key = ?1').bind(templateSleutel(companyId)).first();
  return json({
    company_id: companyId,
    template: (rij && rij.value) || '',
    standaard: TEMPLATE_STANDAARD,
    plaatshouders: PLAATSHOUDERS,
    configured: ingesteld(env),
    template_mode: Boolean(templateNaam(env)),
    log: await logboek(D, companyId),
  });
});

export const onRequestPut = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const companyId = int(input.company_id, null);
  if (!companyId) throw new HttpError('Geen bedrijf gekozen.');
  requireCompany(await guard(env, data), companyId, { manage: true });

  const template = berichtTekst(input.template);
  if (template && !template.includes('{regels}')) {
    throw new HttpError('Zet {regels} in het bericht, anders staat de bestelling er niet in.');
  }
  if (template) {
    await D.prepare(
      `INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(templateSleutel(companyId), template).run();
  } else {
    await D.prepare('DELETE FROM settings WHERE key = ?1').bind(templateSleutel(companyId)).run();
  }
  return json({ ok: true, template, log: await logboek(D, companyId) });
});
