/**
 * De bestelling als WhatsApp-bericht.
 *
 * Er zijn twee wegen naar buiten, en dat is geen luxe maar een gevolg van hoe WhatsApp werkt:
 *
 *  1. **Automatisch versturen** via de WhatsApp Cloud API van Meta. Daarvoor moet er een
 *     WhatsApp Business-nummer zijn met een token (WHATSAPP_TOKEN + WHATSAPP_PHONE_ID).
 *     Meta laat een vrij bericht enkel door binnen 24 uur nadat de leverancier zelf iets
 *     gestuurd heeft. Buiten dat venster moet het via een **goedgekeurde template**
 *     (WHATSAPP_TEMPLATE); de bestelregels gaan dan als één parameter mee, want een
 *     templateparameter mag geen regeleindes bevatten.
 *  2. **Handmatig versturen** via een wa.me-link met het bericht al ingevuld. Eén tik, WhatsApp
 *     opent met de tekst erin, jij duwt op verzenden. Dat werkt zonder token, zonder
 *     goedkeuring van Meta en met de gewone nummers waar nu al naar gestuurd wordt.
 *
 * De tool kiest niet voor jou: staat de API klaar, dan wordt er verstuurd; staat ze er niet,
 * dan krijg je de link. In beide gevallen komt er een regel in whatsapp_messages.
 */
import { fmt } from './order.js';

export const PLAATSHOUDERS = {
  '{bedrijf}': 'de naam van het bedrijf',
  '{leverancier}': 'de naam van de leverancier',
  '{locatie}': 'de locatie waar geteld is',
  '{datum}': 'de datum van de telling, als 28/09/2026',
  '{regels}': 'de bestelregels, elk op een eigen lijn',
  '{aantal}': 'het aantal bestelregels',
  '{totaal}': 'het totaal aantal eenheden',
};

export const TEMPLATE_STANDAARD = [
  'Dag {leverancier},',
  '',
  'Graag deze bestelling voor {bedrijf} — {locatie}:',
  '',
  '{regels}',
  '',
  'Alvast bedankt!',
].join('\n');

/** De sleutel waaronder het standaardbericht van een bedrijf staat. */
export const templateSleutel = (companyId) => `whatsapp_template_${Number(companyId)}`;

/**
 * Een telefoonnummer naar de vorm die WhatsApp verwacht: enkel cijfers, met landnummer.
 * "0479 21 64 33" en "+32 479 21 64 33" worden allebei 32479216433.
 */
export function nummer(ruw) {
  const cijfers = String(ruw || '').replace(/[^\d+]/g, '');
  if (!cijfers) return null;
  if (cijfers.startsWith('+')) return cijfers.slice(1).length >= 8 ? cijfers.slice(1) : null;
  if (cijfers.startsWith('00')) return cijfers.slice(2).length >= 8 ? cijfers.slice(2) : null;
  // een Belgisch nummer dat met 0 begint: 0479… → 32479…
  if (cijfers.startsWith('0')) return cijfers.length >= 9 ? `32${cijfers.slice(1)}` : null;
  return cijfers.length >= 8 ? cijfers : null;
}

/** Hetzelfde nummer, leesbaar terug: 32479216433 → +32 479 21 64 33 */
export function nummerNet(ruw) {
  const n = nummer(ruw);
  if (!n) return '';
  if (n.startsWith('32') && n.length === 11) {
    return `+32 ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7, 9)} ${n.slice(9)}`;
  }
  return `+${n}`;
}

const datumNl = (iso) => {
  const [j, m, d] = String(iso || '').split('-');
  return j ? `${d}/${m}/${j}` : String(iso || '');
};

/** Eén bestelregel: "2 × bak van 24 — Cola (48 fles)" of "3 vat — Jupiler". */
export function regelTekst(line) {
  const pack = Number(line.pack_size) > 0 ? Number(line.pack_size) : 1;
  const unit = line.unit || 'stuk';
  if (pack > 1) {
    const doos = line.pack_label || `${fmt(pack)} ${unit}`;
    return `${fmt(line.order_packs)} × ${doos} — ${line.product_name} (${fmt(line.order_qty)} ${unit})`;
  }
  return `${fmt(line.order_qty)} ${unit} — ${line.product_name}`;
}

export const regelsTekst = (lines) => lines.map((l) => `• ${regelTekst(l)}`).join('\n');

/** Vult de plaatshouders in. Onbekende accolades blijven staan; dat valt op bij het nakijken. */
export function vulIn(template, ctx) {
  const lines = ctx.lines || [];
  const waarden = {
    '{bedrijf}': ctx.company_name || '',
    '{leverancier}': ctx.supplier_name || '',
    '{locatie}': ctx.location_name || '',
    '{datum}': datumNl(ctx.counted_on),
    '{regels}': regelsTekst(lines),
    '{aantal}': String(lines.length),
    '{totaal}': fmt(lines.reduce((a, l) => a + Number(l.order_qty || 0), 0)),
  };
  return String(template || TEMPLATE_STANDAARD)
    .replace(/\{(bedrijf|leverancier|locatie|datum|regels|aantal|totaal)\}/g, (m) => waarden[m] ?? m);
}

/** De link die WhatsApp opent met het bericht al ingevuld. */
export const waLink = (tel, tekst) => {
  const n = nummer(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(tekst)}` : null;
};

/** Staat de Cloud API klaar? Zonder token kan er niet automatisch verstuurd worden. */
export const ingesteld = (env) => Boolean(env && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);

/** Is er een goedgekeurde template ingesteld? Dan mag er ook buiten het venster van 24 uur. */
export const templateNaam = (env) => String((env && env.WHATSAPP_TEMPLATE) || '').trim();

/** Een templateparameter mag geen regeleindes bevatten; de regels worden dan één lijn. */
export const eenLijn = (tekst) => String(tekst).replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim();

const GRAAF = 'https://graph.facebook.com/v21.0';

/**
 * Verstuurt één bericht. Geeft altijd een resultaat terug, nooit een exception, zodat één
 * leverancier die faalt de rest van de bestelling niet tegenhoudt.
 */
export async function verstuur(env, tel, tekst, { fetcher = fetch } = {}) {
  const n = nummer(tel);
  if (!n) return { ok: false, fout: 'Geen geldig telefoonnummer.' };
  if (!ingesteld(env)) return { ok: false, fout: 'WhatsApp is niet ingesteld.', nietIngesteld: true };

  const template = templateNaam(env);
  const payload = template
    ? {
        messaging_product: 'whatsapp', to: n, type: 'template',
        template: {
          name: template,
          language: { code: String(env.WHATSAPP_TAAL || 'nl') },
          components: [{ type: 'body', parameters: [{ type: 'text', text: eenLijn(tekst) }] }],
        },
      }
    : { messaging_product: 'whatsapp', to: n, type: 'text', text: { preview_url: false, body: tekst } };

  let res;
  let uit = {};
  try {
    res = await fetcher(`${GRAAF}/${encodeURIComponent(env.WHATSAPP_PHONE_ID)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    uit = await res.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, fout: `WhatsApp is onbereikbaar: ${err.message}` };
  }

  if (res.ok && uit.messages && uit.messages[0]) {
    return { ok: true, kenmerk: uit.messages[0].id || '' };
  }
  const fout = (uit.error && (uit.error.error_user_msg || uit.error.message)) || `HTTP ${res.status}`;
  const code = uit.error && uit.error.code;
  // 131047: buiten het venster van 24 uur mag een vrij bericht niet; dan is een template nodig
  if (code === 131047 && !template) {
    return {
      ok: false,
      fout: 'WhatsApp laat een vrij bericht enkel door binnen 24 uur nadat de leverancier zelf '
        + 'iets gestuurd heeft. Stel een goedgekeurde template in (WHATSAPP_TEMPLATE) of verstuur '
        + 'dit bericht met de hand via de link.',
      venster: true,
    };
  }
  return { ok: false, fout };
}
