/**
 * Zet het schema (en optioneel voorbeelddata) op de lokale D1-database die
 * `wrangler pages dev --d1 DB=besteltool` in .wrangler/state aanmaakt.
 *
 *   node bestel/scripts/dev-db.mjs [--seed]
 *
 * Start eerst `npm run bestel:dev` (dan bestaat het databestand) en voer dit daarna uit.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const stateDir = join(root, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

if (!existsSync(stateDir)) {
  mkdirSync(stateDir, { recursive: true });
  console.error('Nog geen lokale database gevonden. Start eerst `npm run bestel:dev` en voer dit script daarna opnieuw uit.');
  process.exit(1);
}
const files = readdirSync(stateDir).filter((f) => f.endsWith('.sqlite'));
if (!files.length) {
  console.error('Nog geen lokale database gevonden. Start eerst `npm run bestel:dev` en vraag één pagina op.');
  process.exit(1);
}

/** Voert het schema statement per statement uit; een migratie die al gebeurd is, is geen fout. */
function applySchema(db, sql) {
  for (const chunk of sql.split(/;\s*\n/)) {
    const statement = chunk.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
    if (!statement) continue;
    try {
      db.exec(statement + ';');
    } catch (err) {
      if (/duplicate column|no such column|cannot drop/i.test(err.message)) continue;
      throw err;
    }
  }
}

/** Een lokale database in de oude vorm (zonder bedrijven) opnieuw opbouwen. */
function dropOldShape(db) {
  const columns = db.prepare("SELECT name FROM pragma_table_info('products')").all();
  if (!columns.length || columns.some((c) => c.name === 'company_id')) return;
  for (const table of ['count_lines', 'counts', 'par_levels', 'products', 'suppliers', 'locations']) {
    db.exec(`DROP TABLE IF EXISTS ${table};`);
  }
  db.exec("DELETE FROM settings WHERE key LIKE 'company_%';");
  console.log('lokale database stond nog in de oude vorm en is opnieuw opgebouwd');
}

for (const file of files) {
  const db = new DatabaseSync(join(stateDir, file));
  dropOldShape(db);
  applySchema(db, readFileSync(join(root, 'schema.sql'), 'utf8'));
  if (process.argv.includes('--seed')) applySchema(db, readFileSync(join(root, 'seed.sql'), 'utf8'));
  db.close();
  console.log(`schema toegepast op ${file}${process.argv.includes('--seed') ? ' (met voorbeelddata)' : ''}`);
}
