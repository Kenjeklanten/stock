-- Besteltool JE Concept — D1 (SQLite) schema, versie 2 (meerdere bedrijven).
-- Idempotent: draait bij elke deploy. Elk bedrijf (STVV, Bistro het Vinne, …) heeft zijn eigen
-- locaties, leveranciers en producten; niets wordt tussen bedrijven gedeeld.

CREATE TABLE IF NOT EXISTS companies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  address      TEXT,                       -- adresregel op de bestelbon
  vat          TEXT,                       -- BTW-nummer op de bestelbon
  email        TEXT,                       -- contactadres op de bestelbon
  order_footer TEXT,                       -- voettekst op de bestelbon
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS locations_unique ON locations (company_id, name);

CREATE TABLE IF NOT EXISTS suppliers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  email        TEXT,
  customer_ref TEXT,                      -- ons klantnummer bij deze leverancier
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_unique ON suppliers (company_id, name);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  sku         TEXT,                        -- artikelnummer bij de leverancier
  unit        TEXT    NOT NULL DEFAULT 'stuk',
  pack_size   REAL    NOT NULL DEFAULT 1,  -- besteleenheid: aantal stuks per volle verpakking
  pack_label  TEXT,                        -- bv. "bak van 24"
  category    TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS products_unique ON products (company_id, name, IFNULL(supplier_id, 0));
CREATE INDEX IF NOT EXISTS products_company ON products (company_id, active, sort, name);

-- Basisstock: wat er per locatie in voorraad hoort te zijn.
CREATE TABLE IF NOT EXISTS par_levels (
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  base_qty    REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, product_id)
);

-- Eén telling = één formulier: één locatie, één datum.
CREATE TABLE IF NOT EXISTS counts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  counted_on  TEXT    NOT NULL,                            -- YYYY-MM-DD
  status      TEXT    NOT NULL DEFAULT 'open',             -- open | besteld
  note        TEXT,
  created_by  TEXT,                                        -- e-mailadres via Cloudflare Access
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  ordered_at  TEXT
);
CREATE INDEX IF NOT EXISTS counts_recent ON counts (company_id, counted_on DESC, id DESC);

-- Regels van een telling. Er wordt geteld in volle pakken + losse stuks; base_qty, pack_size en de
-- naam worden mee bewaard zodat een oude bestelbon niet verandert als de catalogus later wijzigt.
CREATE TABLE IF NOT EXISTS count_lines (
  count_id      INTEGER NOT NULL REFERENCES counts(id)   ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  product_name  TEXT    NOT NULL,
  counted_packs REAL,                                       -- volle pakken (× pack_size)
  counted_loose REAL,                                       -- losse stuks buiten een pak
  counted_qty   REAL,                                       -- totaal in eenheden; NULL = niet geteld
  base_qty      REAL    NOT NULL DEFAULT 0,
  pack_size     REAL    NOT NULL DEFAULT 1,
  order_qty     REAL    NOT NULL DEFAULT 0,                  -- te bestellen, in eenheden
  PRIMARY KEY (count_id, product_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('csv_delimiter', ';'),
  ('schema_version', '2');
