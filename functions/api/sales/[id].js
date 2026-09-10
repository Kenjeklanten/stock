/**
 * GET    /api/sales/:id    het verschilrapport van één verkoopdag
 * DELETE /api/sales/:id
 *
 * De vraag die dit beantwoordt: is er evenveel uit de stock verdwenen als er verkocht is?
 *
 *   verbruik = geteld bij de telling vóór die dag + wat er toen geleverd is − geteld bij de
 *              eerstvolgende telling erna
 *   verkocht = aantal uit de kassa × voorraadeenheden per verkocht stuk
 *   verschil = verbruik − verkocht
 *
 * Een positief verschil is wat er weg is zonder verkoop. Een negatief verschil wijst op een
 * telfout of een koppeling die niet klopt — daarom staat er bij elke regel bij waar de cijfers
 * vandaan komen.
 */
import { json, handler, db, int, HttpError } from '../../_lib/http.js';
import { scopeFor, requireCompany } from '../../_lib/access.js';
import { round2 } from '../../_lib/order.js';

const idVan = (params) => {
  const id = int(params.id, null);
  if (!id) throw new HttpError('Ongeldig nummer.', 400);
  return id;
};

export const onRequestGet = handler(async ({ params, env, data }) => {
  const D = db(env);
  const id = idVan(params);

  const rapport = await D.prepare(
    'SELECT i.*, c.name AS company_name FROM sales_imports i JOIN companies c ON c.id = i.company_id WHERE i.id = ?1'
  ).bind(id).first();
  if (!rapport) throw new HttpError('Dat verkooprapport bestaat niet.', 404);
  requireCompany(await scopeFor(D, data.user), rapport.company_id);

  // 1. de verkoop, al vertaald naar producten en locaties -------------------------------------
  const verkoopRijen = await D.prepare(
    `SELECT sl.article_name, sl.location_name, sl.qty, sl.revenue,
            sa.product_id, sa.units_per_sale, sa.ignored AS article_ignored,
            sloc.location_id, sloc.ignored AS location_ignored,
            p.name AS product_name, p.unit
       FROM sales_lines sl
       LEFT JOIN sales_articles  sa   ON sa.company_id = ?2 AND lower(sa.name)   = lower(sl.article_name)
       LEFT JOIN sales_locations sloc ON sloc.company_id = ?2 AND lower(sloc.name) = lower(sl.location_name)
       LEFT JOIN products p ON p.id = sa.product_id
      WHERE sl.import_id = ?1`
  ).bind(id, rapport.company_id).all();

  const verkocht = new Map();        // "locatie:product" → { qty, revenue }
  const losseArtikelen = new Map();  // nog niet gekoppeld
  const losseLocaties = new Map();
  let omzet = 0;

  for (const r of verkoopRijen.results || []) {
    omzet += Number(r.revenue || 0);
    if (r.article_ignored || r.location_ignored) continue;
    if (!r.product_id) {
      const vorige = losseArtikelen.get(r.article_name) || 0;
      losseArtikelen.set(r.article_name, round2(vorige + Number(r.qty)));
      continue;
    }
    if (!r.location_id) {
      const vorige = losseLocaties.get(r.location_name) || 0;
      losseLocaties.set(r.location_name, round2(vorige + Number(r.qty)));
      continue;
    }
    const sleutel = `${r.location_id}:${r.product_id}`;
    const vorige = verkocht.get(sleutel) || { location_id: r.location_id, product_id: r.product_id, qty: 0, revenue: 0 };
    vorige.qty += Number(r.qty) * Number(r.units_per_sale || 1);
    vorige.revenue += Number(r.revenue || 0);
    verkocht.set(sleutel, vorige);
  }

  // 2. de tellingen die de verkoopdag omsluiten ------------------------------------------------
  const locatieIds = [...new Set([...verkocht.values()].map((v) => v.location_id))];
  const rijen = [];
  const waarschuwingen = [];

  for (const locationId of locatieIds) {
    const [voor, na] = await Promise.all([
      D.prepare(
        `SELECT id, counted_on, status FROM counts
          WHERE location_id = ?1 AND counted_on <= ?2 ORDER BY counted_on DESC, id DESC LIMIT 1`
      ).bind(locationId, rapport.sold_on).first(),
      D.prepare(
        `SELECT id, counted_on FROM counts
          WHERE location_id = ?1 AND counted_on > ?2 ORDER BY counted_on ASC, id ASC LIMIT 1`
      ).bind(locationId, rapport.sold_on).first(),
    ]);
    const locatie = await D.prepare('SELECT name FROM locations WHERE id = ?1').bind(locationId).first();
    const naam = (locatie && locatie.name) || `Locatie ${locationId}`;

    if (!voor || !na) {
      waarschuwingen.push(!voor
        ? `${naam}: er is geen telling van vóór ${rapport.sold_on}, dus het verbruik is daar niet te berekenen.`
        : `${naam}: er is nog geen telling ná ${rapport.sold_on}. Tel die locatie en het verschil verschijnt hier.`);
      continue;
    }

    const [voorLijnen, naLijnen] = await Promise.all([
      D.prepare(
        `SELECT cl.product_id, cl.product_name, cl.counted_qty, cl.received_qty, cl.order_qty, cl.pack_size,
                p.unit
           FROM count_lines cl LEFT JOIN products p ON p.id = cl.product_id
          WHERE cl.count_id = ?1`
      ).bind(voor.id).all(),
      D.prepare('SELECT product_id, counted_qty FROM count_lines WHERE count_id = ?1').bind(na.id).all(),
    ]);
    const eind = new Map((naLijnen.results || []).map((l) => [l.product_id, l.counted_qty]));

    for (const l of voorLijnen.results || []) {
      const sleutel = `${locationId}:${l.product_id}`;
      const verkoop = verkocht.get(sleutel);
      const begin = l.counted_qty;
      const einde = eind.has(l.product_id) ? eind.get(l.product_id) : null;

      // Is de levering nagekeken, dan tellen we wat er binnenkwam; anders wat er besteld is.
      const nagekeken = l.received_qty !== null && l.received_qty !== undefined;
      const geleverd = nagekeken ? Number(l.received_qty) : Number(l.order_qty || 0);

      if (begin === null || begin === undefined || einde === null || einde === undefined) {
        if (verkoop && verkoop.qty > 0) {
          waarschuwingen.push(`${naam} · ${l.product_name}: niet geteld ${begin === null || begin === undefined ? 'vóór' : 'ná'} de verkoopdag, dus geen verschil te berekenen.`);
        }
        continue;
      }

      const verbruikt = round2(Number(begin) + geleverd - Number(einde));
      const verkochtQty = round2(verkoop ? verkoop.qty : 0);
      const verschil = round2(verbruikt - verkochtQty);
      // wat één voorraadeenheid opbrengt aan de kassa, om het verschil in euro te tonen
      const perEenheid = verkoop && verkoop.qty > 0 ? verkoop.revenue / verkoop.qty : null;

      if (verbruikt === 0 && verkochtQty === 0) continue;
      rijen.push({
        location_id: locationId, location_name: naam,
        product_id: l.product_id, product_name: l.product_name, unit: l.unit || 'stuk',
        begin: Number(begin), geleverd: round2(geleverd), eind: Number(einde),
        geleverd_nagekeken: nagekeken,
        verbruikt, verkocht: verkochtQty, verschil,
        waarde: perEenheid === null ? null : round2(verschil * perEenheid),
        count_before: voor.id, count_after: na.id,
        counted_before: voor.counted_on, counted_after: na.counted_on,
      });
    }
  }

  rijen.sort((a, b) => Math.abs(b.waarde ?? 0) - Math.abs(a.waarde ?? 0) || b.verschil - a.verschil);

  return json({
    import: rapport,
    rows: rijen,
    totals: {
      omzet: round2(omzet),
      verschil_waarde: round2(rijen.reduce((a, r) => a + (r.waarde || 0), 0)),
      regels_met_verschil: rijen.filter((r) => Math.abs(r.verschil) > 0.001).length,
    },
    unmapped_articles: [...losseArtikelen.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    unmapped_locations: [...losseLocaties.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    warnings: waarschuwingen,
  });
});

export const onRequestDelete = handler(async ({ params, env, data }) => {
  const D = db(env);
  const id = idVan(params);
  const rapport = await D.prepare('SELECT company_id FROM sales_imports WHERE id = ?1').bind(id).first();
  if (!rapport) throw new HttpError('Dat verkooprapport bestaat niet.', 404);
  requireCompany(await scopeFor(D, data.user), rapport.company_id, { manage: true });
  await D.prepare('DELETE FROM sales_lines WHERE import_id = ?1').bind(id).run();
  await D.prepare('DELETE FROM sales_imports WHERE id = ?1').bind(id).run();
  return json({ ok: true });
});
