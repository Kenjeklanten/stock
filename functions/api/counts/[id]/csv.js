import { handler, db, int, HttpError } from '../../../_lib/http.js';
import { loadCount, groupBySupplier } from '../../../_lib/store.js';
import { scopeFor, requireCompany, companyOfCount } from '../../../_lib/access.js';
import { toCsv, slug } from '../../../_lib/csv.js';
import { fmt, orderPacks } from '../../../_lib/order.js';

/**
 * GET /api/counts/:id/csv[?supplier=<id>][&scope=all]
 *   standaard: enkel de bestelregels (te bestellen > 0)
 *   scope=all: het volledige telblad (alle producten, ook wat niet besteld moet worden)
 */
export const onRequestGet = handler(async ({ params, request, env, data }) => {
  const D = db(env);
  const id = int(params.id, null);
  if (!id) throw new HttpError('Ongeldig nummer.');
  requireCompany(await scopeFor(D, data.user), await companyOfCount(D, id));
  const url = new URL(request.url);
  const supplier = url.searchParams.get('supplier');
  const all = url.searchParams.get('scope') === 'all';

  const { count, lines, settings } = await loadCount(D, id);
  const delimiter = (settings.csv_delimiter || ';').slice(0, 1) || ';';

  const selected = all
    ? (supplier === null ? lines : lines.filter((l) => String(l.supplier_id ?? 0) === String(supplier)))
    : groupBySupplier(lines, supplier === null ? null : supplier).flatMap((g) => g.lines);

  const headers = ['Leverancier', 'Klantnummer', 'Product', 'Eenheid',
    'Verpakking', 'Basisstock', 'Geteld volle pakken', 'Geteld losse stuks', 'Geteld totaal',
    'Tekort', 'Te bestellen', 'Aantal verpakkingen', 'Geleverd', 'Verschil'];
  const notCounted = (l) => l.counted_qty === null || l.counted_qty === undefined;
  const rows = selected.map((l) => [
    l.supplier_name || '', l.customer_ref || '', l.product_name, l.unit || 'stuk',
    l.pack_label || (Number(l.pack_size) > 1 ? `${fmt(l.pack_size)} ${l.unit || 'stuk'}` : ''),
    fmt(l.base_qty),
    notCounted(l) || l.counted_packs === null || l.counted_packs === undefined ? '' : fmt(l.counted_packs),
    notCounted(l) || l.counted_loose === null || l.counted_loose === undefined ? '' : fmt(l.counted_loose),
    notCounted(l) ? '' : fmt(l.counted_qty),
    fmt(l.shortage), fmt(l.order_qty), fmt(orderPacks(l.order_qty, l.pack_size)),
    l.received_qty === null || l.received_qty === undefined ? '' : fmt(l.received_qty),
    l.received_diff === null || l.received_diff === undefined ? '' : fmt(l.received_diff),
  ]);

  const name = `${all ? 'telling' : 'bestelling'}-${slug(count.company_name)}-${slug(count.location_name)}-${count.counted_on}` +
    (supplier !== null && selected.length ? `-${slug(selected[0].supplier_name || 'zonder-leverancier')}` : '') + '.csv';

  return new Response(toCsv(headers, rows, delimiter), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
});
