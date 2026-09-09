-- Voorbeelddata om de tool te leren kennen (lokaal: `node bestel/scripts/dev-db.mjs --seed`).
INSERT OR IGNORE INTO companies (id, name, address, vat, email, order_footer, sort) VALUES
  (1, 'STVV',              'Stayen 1, 3800 Sint-Truiden',        'BE 0123.456.789', 'inkoop@stvv.example',  'Leveren via de leveranciersingang, ten laatste om 10u.', 1),
  (2, 'Bistro het Vinne',  'Vinnestraat 2, 3440 Zoutleeuw',      'BE 0987.654.321', 'bistro@vinne.example', 'Leveren aan de keukendeur.', 2);

INSERT OR IGNORE INTO locations (id, company_id, name, sort) VALUES
  (1, 1, 'Bar tribune 1', 1), (2, 1, 'Bar tribune 2', 2), (3, 1, 'Magazijn', 3),
  (4, 2, 'Bar', 1), (5, 2, 'Keuken', 2);

INSERT OR IGNORE INTO suppliers (id, company_id, name, email, customer_ref, sort) VALUES
  (1, 1, 'Drankencentrale',         'orders@drankencentrale.example', 'KL-1042', 1),
  (2, 1, 'Groothandel Foodservice', 'bestel@foodservice.example',     '88231',   2),
  (3, 2, 'Drankencentrale',         'orders@drankencentrale.example', 'KL-2088', 1);

INSERT OR IGNORE INTO products (id, company_id, name, sku, unit, pack_size, pack_label, category, supplier_id, sort) VALUES
  (1, 1, 'Pils 25cl',       'P25',  'fles', 24, 'bak van 24',  'Bier',      1, 1),
  (2, 1, 'Cola 33cl',       'C33',  'blik', 24, 'bak van 24',  'Frisdrank', 1, 2),
  (3, 1, 'Plat water 50cl', 'W50',  'fles', 12, 'bak van 12',  'Frisdrank', 1, 3),
  (4, 1, 'Chips paprika',   'CP',   'zak',   1, '',            'Snacks',    2, 4),
  (5, 1, 'Bekers 25cl',     'BK25', 'stuk', 50, 'rol van 50',  'Verbruik',  2, 5),
  (6, 2, 'Huiswijn wit',    'HW',   'fles',  6, 'doos van 6',  'Wijn',      3, 1),
  (7, 2, 'Koffiebonen',     'KB1',  'kg',    1, '',            'Warme dranken', 3, 2);

INSERT OR IGNORE INTO par_levels (location_id, product_id, base_qty)
SELECT l.id, p.id, p.pack_size * 2
  FROM locations l JOIN products p ON p.company_id = l.company_id
 WHERE l.id IN (1, 2, 4);
INSERT OR IGNORE INTO par_levels (location_id, product_id, base_qty)
SELECT l.id, p.id, p.pack_size * 6
  FROM locations l JOIN products p ON p.company_id = l.company_id
 WHERE l.id = 3;
INSERT OR IGNORE INTO par_levels (location_id, product_id, base_qty)
SELECT l.id, p.id, 12
  FROM locations l JOIN products p ON p.company_id = l.company_id
 WHERE l.id = 5 AND p.category IN ('Warme dranken', 'Wijn');
