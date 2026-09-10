-- Besteltool JE Concept — D1 (SQLite) schema, versie 2 (meerdere bedrijven).
-- Idempotent: draait bij elke deploy. Elk bedrijf (STVV, Bistro het Vinne, …) heeft zijn eigen
-- locaties, leveranciers en producten; niets wordt tussen bedrijven gedeeld.

CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Adres, BTW-nummer, contactadres en voettekst zijn eruit: de bestelbon draagt enkel de naam.
ALTER TABLE companies DROP COLUMN address;
ALTER TABLE companies DROP COLUMN vat;
ALTER TABLE companies DROP COLUMN email;
ALTER TABLE companies DROP COLUMN order_footer;

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
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- E-mailadres, klantnummer en de actief-vlag zijn eruit: ze werden nergens gebruikt.
ALTER TABLE suppliers DROP COLUMN email;
ALTER TABLE suppliers DROP COLUMN customer_ref;
ALTER TABLE suppliers DROP COLUMN active;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_unique ON suppliers (company_id, name);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  unit        TEXT    NOT NULL DEFAULT 'stuk',
  pack_size   REAL    NOT NULL DEFAULT 1,  -- besteleenheid: aantal stuks per volle verpakking
  pack_label  TEXT,                        -- bv. "bak van 24"
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS products_unique ON products (company_id, name, IFNULL(supplier_id, 0));
CREATE INDEX IF NOT EXISTS products_company ON products (company_id, active, sort, name);

-- Migratie voor databases van vóór deze versie: artikelnummer en categorie zijn eruit.
-- Bestaan de kolommen niet meer, dan negeert de deploy de fout (zie .github/scripts).
ALTER TABLE products DROP COLUMN sku;
ALTER TABLE products DROP COLUMN category;

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
  status      TEXT    NOT NULL DEFAULT 'open',             -- open | besteld | geleverd
  note        TEXT,
  created_by  TEXT,                                        -- e-mailadres via Cloudflare Access
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  ordered_at  TEXT,
  received_at TEXT,                                        -- wanneer de levering is nagekeken
  received_by TEXT                                         -- wie ze heeft nagekeken
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
  received_packs REAL,                                      -- ontvangstcontrole: volle pakken
  received_loose REAL,                                      -- ontvangstcontrole: losse stuks
  received_qty   REAL,                                      -- ontvangen totaal; NULL = nog niet nagekeken
  PRIMARY KEY (count_id, product_id)
);

-- Migratie voor databases van vóór de ontvangstcontrole. Bestaan de kolommen al, dan negeert
-- de deploy de fout (zie .github/scripts/cloudflare.py).
ALTER TABLE counts      ADD COLUMN received_at    TEXT;
ALTER TABLE counts      ADD COLUMN received_by    TEXT;
ALTER TABLE count_lines ADD COLUMN received_packs REAL;
ALTER TABLE count_lines ADD COLUMN received_loose REAL;
ALTER TABLE count_lines ADD COLUMN received_qty   REAL;

-- Toegang loopt volledig via de codes hieronder; de vroegere ledenlijst op e-mailadres is weg.
DROP TABLE IF EXISTS members;

-- ---------------------------------------------------------------------------------------------
-- Verkoop uit de kassa. Wat er verkocht is, naast wat er uit de stock verdwenen is: het verschil
-- tussen die twee is wat er weggegeven, gemorst of gestolen is.
--
-- De kassa spreekt een andere taal dan de voorraad: ze verkoopt "Jupiler 30cl 3,3" aan de toog
-- "Oost - Toog 2", terwijl de voorraad "Jupiler 50l" op "Toog 2" telt. Twee koppeltabellen
-- vertalen dat, en ze worden onthouden zodat een volgende import vanzelf klopt.

CREATE TABLE IF NOT EXISTS sales_articles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,                       -- exact zoals in de kassa-export
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  units_per_sale REAL    NOT NULL DEFAULT 1,             -- voorraadeenheden per verkocht stuk
  ignored        INTEGER NOT NULL DEFAULT 0,             -- 1 = telt niet mee (waarborg, testartikel, …)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_articles_unique ON sales_articles (company_id, lower(name));

CREATE TABLE IF NOT EXISTS sales_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,                          -- exact zoals in de kassa-export
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  ignored     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_locations_unique ON sales_locations (company_id, lower(name));

-- Eén ingelezen bestand = één wedstrijd of één dag.
CREATE TABLE IF NOT EXISTS sales_imports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,                           -- bv. "Speeldag 10"
  sold_on    TEXT    NOT NULL,                           -- YYYY-MM-DD
  note       TEXT,
  created_by TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sales_imports_recent ON sales_imports (company_id, sold_on DESC, id DESC);

CREATE TABLE IF NOT EXISTS sales_lines (
  import_id     INTEGER NOT NULL REFERENCES sales_imports(id) ON DELETE CASCADE,
  article_name  TEXT    NOT NULL,                        -- zoals in het bestand
  location_name TEXT    NOT NULL,
  qty           REAL    NOT NULL DEFAULT 0,
  revenue       REAL,                                    -- EUR incl. btw
  PRIMARY KEY (import_id, article_name, location_name)
);

-- Toegangscodes: de cijfercode die vóór de hele tool zit. Elke code draagt haar eigen rechten,
-- dus wie enkel mag tellen krijgt een andere code dan wie alles mag. company_id leeg = alle
-- bedrijven. Staat er geen enkele actieve code in, dan wordt er niets gevraagd.
CREATE TABLE IF NOT EXISTS access_codes (
  code       TEXT    PRIMARY KEY,                 -- 4 tot 8 cijfers
  label      TEXT    NOT NULL,                    -- waarvoor deze code dient
  role       TEXT    NOT NULL DEFAULT 'teller',   -- teller | beheerder
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '2');

-- Het scheidingsteken van de CSV staat vast op een puntkomma (Excel in België en Nederland).
DELETE FROM settings WHERE key IN ('csv_delimiter', 'pin');

-- De twee codes waarmee gestart wordt. Ze staan hier zodat een verse installatie meteen
-- bruikbaar is; aanpassen gebeurt daarna in Beheer → Toegang.
INSERT OR IGNORE INTO access_codes (code, label, role, company_id) VALUES
  ('1011', 'Volledige toegang', 'beheerder', NULL);
INSERT OR IGNORE INTO access_codes (code, label, role, company_id)
  SELECT '8956', 'Tellen STVV', 'teller', id FROM companies WHERE name = 'STVV';
