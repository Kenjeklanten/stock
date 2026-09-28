/**
 * De bestelling van een telling naar de leveranciers sturen.
 *
 * GET  /api/whatsapp?count_id=…              wat er verstuurd zou worden, per leverancier
 * POST /api/whatsapp  { count_id, suppliers: [{ supplier_id, body }], handmatig }
 *
 * De POST verstuurt en houdt bij wat er buitengegaan is. `handmatig: true` verstuurt niets maar
 * legt vast dat het bericht via de link doorgegeven is — zo blijft het logboek volledig, ook
 * wanneer de Cloud API niet ingesteld is.
 */
import { json, handler, db, body, int, HttpError } from '../_lib/http.js';
import { scopeFor, requireCompany, companyOfCount } from '../_lib/access.js';
import { loadCount, groupBySupplier } from '../_lib/store.js';
import {
  vulIn, waLink, nummer, nummerNet, ingesteld, templateNaam, verstuur,
  TEMPLATE_STANDAARD, templateSleutel,
} from '../_lib/whatsapp.js';

/** Het bericht van dit bedrijf, of het standaardbericht. */
async function bedrijfsTemplate(D, companyId) {
  const rij = await D.prepare('SELECT value FROM settings WHERE key = ?1').bind(templateSleutel(companyId)).first();
  return (rij && rij.value) || TEMPLATE_STANDAARD;
}

/**
 * Stelt per leverancier het bericht op, en zegt waarom een leverancier overgeslagen wordt.
 * Overslaan is nooit stil: je moet op het scherm kunnen zien waarom Gelade er niet bij staat.
 */
async function voorstel(D, env, countId) {
  const detail = await loadCount(D, countId);
  const count = detail.count;
  const groepen = groupBySupplier(detail.lines);

  const locatie = await D.prepare('SELECT whatsapp_active FROM locations WHERE id = ?1')
    .bind(count.location_id).first();
  const locatieAan = !locatie || locatie.whatsapp_active !== 0;

  const standaard = await bedrijfsTemplate(D, count.company_id);
  const rijen = await D.prepare(
    'SELECT id, name, whatsapp, whatsapp_active, whatsapp_template FROM suppliers WHERE company_id = ?1'
  ).bind(count.company_id).all();
  const perId = new Map((rijen.results || []).map((r) => [r.id, r]));

  const berichten = groepen.map((groep) => {
    const sup = groep.supplier_id ? perId.get(groep.supplier_id) : null;
    const tekst = vulIn(sup && sup.whatsapp_template ? sup.whatsapp_template : standaard, {
      company_name: count.company_name,
      supplier_name: groep.supplier_name,
      location_name: count.location_name,
      counted_on: count.counted_on,
      lines: groep.lines,
    });
    const tel = sup ? nummer(sup.whatsapp) : null;

    let overslaan = null;
    if (!sup) overslaan = 'Deze producten hebben geen leverancier.';
    else if (!tel) overslaan = 'Deze leverancier heeft geen WhatsApp-nummer in Beheer.';
    else if (sup.whatsapp_active === 0) overslaan = 'WhatsApp staat uit voor deze leverancier.';
    else if (!locatieAan) overslaan = `WhatsApp staat uit voor ${count.location_name}.`;

    return {
      supplier_id: groep.supplier_id,
      supplier_name: groep.supplier_name,
      lines: groep.lines.length,
      units: groep.lines.reduce((a, l) => a + Number(l.order_qty || 0), 0),
      to_number: tel,
      to_display: sup ? nummerNet(sup.whatsapp) : '',
      eigen_bericht: Boolean(sup && sup.whatsapp_template),
      body: tekst,
      link: tel ? waLink(tel, tekst) : null,
      skip: overslaan,
    };
  });

  return {
    count: {
      id: count.id, company_id: count.company_id, company_name: count.company_name,
      location_id: count.location_id, location_name: count.location_name,
      counted_on: count.counted_on, status: count.status,
    },
    location_active: locatieAan,
    configured: ingesteld(env),
    template_mode: Boolean(templateNaam(env)),
    messages: berichten,
  };
}

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const countId = int(new URL(request.url).searchParams.get('count_id'), null);
  if (!countId) throw new HttpError('Geen telling gekozen.');
  requireCompany(await scopeFor(D, data.user), await companyOfCount(D, countId));
  return json(await voorstel(D, env, countId));
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const countId = int(input.count_id, null);
  if (!countId) throw new HttpError('Geen telling gekozen.');
  requireCompany(await scopeFor(D, data.user), await companyOfCount(D, countId));

  const plan = await voorstel(D, env, countId);
  const gevraagd = Array.isArray(input.suppliers) ? input.suppliers : [];
  if (!gevraagd.length) throw new HttpError('Geen leverancier gekozen.');
  const handmatig = input.handmatig === true;

  const wie = (data.user && (data.user.email || (data.user.code && data.user.code.label))) || '';
  const uitkomsten = [];

  for (const vraag of gevraagd) {
    const id = int(vraag.supplier_id, null);
    const bericht = plan.messages.find((m) => m.supplier_id === id);
    if (!bericht) {
      uitkomsten.push({ supplier_id: id, ok: false, fout: 'Deze leverancier staat niet op deze bestelling.' });
      continue;
    }
    if (bericht.skip) {
      uitkomsten.push({ supplier_id: id, supplier_name: bericht.supplier_name, ok: false, fout: bericht.skip });
      continue;
    }
    // een aangepast bericht van het scherm mag voorgaan op het opgestelde
    const tekst = typeof vraag.body === 'string' && vraag.body.trim() ? vraag.body.slice(0, 4000) : bericht.body;

    const res = handmatig
      ? { ok: true, handmatig: true }
      : await verstuur(env, bericht.to_number, tekst);

    await D.prepare(
      `INSERT INTO whatsapp_messages
         (company_id, count_id, supplier_id, supplier_name, location_name, to_number, body, status, detail, sent_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(
      plan.count.company_id, countId, id, bericht.supplier_name, plan.count.location_name,
      bericht.to_number, tekst,
      handmatig ? 'handmatig' : (res.ok ? 'verzonden' : 'mislukt'),
      handmatig ? 'via de link doorgegeven' : (res.ok ? (res.kenmerk || '') : res.fout),
      wie,
    ).run();

    uitkomsten.push({
      supplier_id: id, supplier_name: bericht.supplier_name, ok: res.ok,
      handmatig, fout: res.ok ? null : res.fout, venster: res.venster === true,
      nietIngesteld: res.nietIngesteld === true,
    });
  }

  // eens er doorgegeven is, staat de bestelling op besteld — daar hoort geen tweede klik bij
  if (uitkomsten.some((u) => u.ok)) {
    await D.prepare(
      `UPDATE counts SET status = 'besteld', ordered_at = COALESCE(ordered_at, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ?1 AND status = 'open'`
    ).bind(countId).run();
  }

  return json({ results: uitkomsten, verzonden: uitkomsten.filter((u) => u.ok).length });
});
