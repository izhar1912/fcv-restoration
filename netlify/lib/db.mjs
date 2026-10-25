// Database access: Netlify Database (managed Postgres). Falls back to DATABASE_URL for any other Postgres.
// Exposes { query(text, params) -> rows, tx(fn) } so tests can swap in an in-process Postgres.
import { getDatabase } from '@netlify/database';

let cached;

function adapt(pool) {
  return {
    async query(text, params = []) {
      const res = await pool.query(text, params);
      return res.rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const q = { query: async (text, params = []) => (await client.query(text, params)).rows };
        const out = await fn(q);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    }
  };
}

export function db() {
  const test = globalThis.__FCV_TEST__ && globalThis.__FCV_TEST__.db;
  if (test) return test;
  if (!cached) {
    const conn = process.env.DATABASE_URL ? getDatabase({ connectionString: process.env.DATABASE_URL }) : getDatabase();
    cached = adapt(conn.pool);
  }
  return cached;
}
