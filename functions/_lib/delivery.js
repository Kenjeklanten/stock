/**
 * Leveringen: de bestelling die uit één telling volgde, met hoever het nakijken staat.
 *
 * Zowel het dashboard als de pagina /leveringen tonen dezelfde lijst, dus staat de vraag hier
 * één keer. "Nog na te kijken" hangt aan `received_at`, niet aan de status: een bestelling die
 * doorgegeven is zonder op "markeer als besteld" te duwen, moet even goed nagekeken worden.
 */
const KOLOMMEN = `
  SELECT c.id, c.counted_on, c.status, c.ordered_at, c.received_at, c.received_by,
         c.location_id, l.name AS location_name,
         (SELECT COUNT(*) FROM count_lines cl
           WHERE cl.count_id = c.id AND cl.order_qty > 0) AS order_lines,
         (SELECT COUNT(*) FROM count_lines cl
           WHERE cl.count_id = c.id AND cl.order_qty > 0 AND cl.received_qty IS NOT NULL) AS checked_lines,
         (SELECT COUNT(*) FROM count_lines cl
           WHERE cl.count_id = c.id AND cl.order_qty > 0 AND cl.received_qty IS NOT NULL
             AND cl.received_qty <> cl.order_qty) AS diff_lines,
         (SELECT COUNT(DISTINCT IFNULL(p.supplier_id, 0)) FROM count_lines cl
            LEFT JOIN products p ON p.id = cl.product_id
           WHERE cl.count_id = c.id AND cl.order_qty > 0) AS supplier_count
    FROM counts c JOIN locations l ON l.id = c.location_id
   WHERE c.company_id = ?1`;

/** Alles waar iets op te bestellen stond en wat nog niet afgesloten is. */
export async function openLeveringen(D, companyId, { limit = 50 } = {}) {
  const rows = await D.prepare(
    `SELECT * FROM (${KOLOMMEN} AND c.received_at IS NULL)
      WHERE order_lines > 0
      ORDER BY counted_on DESC, id DESC LIMIT ${Number(limit) || 50}`
  ).bind(companyId).all();
  return rows.results || [];
}

/** Afgesloten leveringen, de jongste eerst. */
export async function nagekekenLeveringen(D, companyId, { limit = 25 } = {}) {
  const rows = await D.prepare(
    `SELECT * FROM (${KOLOMMEN} AND c.received_at IS NOT NULL)
      WHERE order_lines > 0
      ORDER BY received_at DESC, id DESC LIMIT ${Number(limit) || 25}`
  ).bind(companyId).all();
  return rows.results || [];
}
