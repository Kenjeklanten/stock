// Kleine D1-nabootsing op node:sqlite, zodat de Pages Functions zonder Cloudflare getest kunnen worden.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  #prep() { return this.db.prepare(this.sql); }
  async all() { return { results: this.#prep().all(...this.args), success: true }; }
  async first(column) {
    const row = this.#prep().get(...this.args) ?? null;
    return row && column ? row[column] : row;
  }
  async run() {
    const res = this.#prep().run(...this.args);
    return { success: true, meta: { last_row_id: Number(res.lastInsertRowid), changes: Number(res.changes) } };
  }
}

export function createDb(schemaPath) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  // Statement per statement, net als bij de deploy: een migratie die al gebeurd is, is geen fout.
  for (const chunk of readFileSync(schemaPath, 'utf8').split(/;\s*\n/)) {
    const statement = chunk.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
    if (!statement) continue;
    try { db.exec(statement + ';'); } catch (err) { if (!/duplicate column/i.test(err.message)) throw err; }
  }
  return {
    prepare: (sql) => new Statement(db, sql),
    batch: async (statements) => { const out = []; for (const s of statements) out.push(await s.run()); return out; },
    exec: async (sql) => { db.exec(sql); },
    _raw: db,
  };
}

/** Bouwt de context die een Pages Function krijgt. */
export const ctx = (env, { method = 'GET', url = 'https://bestel.test/', body = null, params = {}, user = { email: 'test@jeconcept.be', admin: true, protected: true } } = {}) => ({
  request: new Request(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }),
  env,
  params,
  data: { user },
});
