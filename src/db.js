'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

let _pool;
function getPool() {
  if (_pool) return _pool;
  const { Pool } = require('pg'); // loaded lazily so unit tests run without a database
  _pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  _pool.on && _pool.on('error', err => console.error('[db] idle client error', err.message));
  return _pool;
}
const pool = { query: (...a) => getPool().query(...a), connect: () => getPool().connect(), end: () => (_pool ? _pool.end() : Promise.resolve()) };

const query = (text, params) => getPool().query(text, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(config.root, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set((await query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(async c => {
      for (const stmt of splitSql(sql)) await c.query(stmt);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    console.log(`[db] applied migration ${f}`);
  }
}

// Splits on semicolons at line ends; migrations avoid functions/DO blocks so this stays simple.
function splitSql(sql) {
  return sql.replace(/--.*$/gm, '').split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
}

module.exports = { pool, query, tx, migrate };
