import { handler, db, int, HttpError } from '../../../_lib/http.js';
import { loadCount, groupBySupplier } from '../../../_lib/store.js';
import { buildOrderPdf } from '../../../_lib/order-pdf.js';
import { slug } from '../../../_lib/csv.js';

/** GET /api/counts/:id/pdf[?supplier=<id>] — bestelbon als PDF (één sectie per leverancier). */
export const onRequestGet = handler(async ({ params, request, env }) => {
  const D = db(env);
  const id = int(params.id, null);
  if (!id) throw new HttpError('Ongeldig nummer.');
  const supplier = new URL(request.url).searchParams.get('supplier');

  const { count, lines } = await loadCount(D, id);
  const groups = groupBySupplier(lines, supplier);
  const bytes = buildOrderPdf({ count, groups });

  const name = `bestelbon-${slug(count.company_name)}-${slug(count.location_name)}-${count.counted_on}` +
    (supplier !== null && groups.length === 1 ? `-${slug(groups[0].supplier_name)}` : '') + '.pdf';

  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
});
