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

-- Wie mag wat. Zolang deze tabel leeg is, mag iedereen met toegang alles (zo sluit je jezelf
-- niet buiten). Zodra er één rij in staat, telt ze: je ziet enkel de bedrijven waarvoor je een
-- rij hebt. Rol 'beheerder' mag de catalogus van dat bedrijf aanpassen, 'teller' mag enkel tellen.
-- De adressen uit ADMIN_EMAILS blijven altijd overal aan mogen.
CREATE TABLE IF NOT EXISTS members (
  email      TEXT    NOT NULL,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'teller',   -- teller | beheerder
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, company_id)
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

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('csv_delimiter', ';'),
  ('schema_version', '2');

-- De ene toegangscode uit de eerste versie is vervangen door de tabel hierboven.
DELETE FROM settings WHERE key = 'pin';

-- De twee codes waarmee gestart wordt. Ze staan hier zodat een verse installatie meteen
-- bruikbaar is; aanpassen gebeurt daarna in Beheer → Toegang.
INSERT OR IGNORE INTO access_codes (code, label, role, company_id) VALUES
  ('1011', 'Volledige toegang', 'beheerder', NULL);
INSERT OR IGNORE INTO access_codes (code, label, role, company_id)
  SELECT '8956', 'Tellen STVV', 'teller', id FROM companies WHERE name = 'STVV';
