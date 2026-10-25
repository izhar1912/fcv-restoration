// Test harness: a real Postgres (PGlite) + stand-ins for Netlify Identity, Blobs and the Apps Script sheet.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.join(here, '../netlify/database/migrations/20261022120000_portal_init.sql'), 'utf8');
export const ORIGIN = 'https://portal.test';
export const ADMIN = 'owner@fcv.test';
process.env.FCV_ADMIN_EMAILS = ADMIN;
process.env.FCV_SHEET_ENDPOINT = 'https://script.test/exec';
process.env.FCV_SHEET_SERVICE_KEY = 'svc-key';

const realFetch = globalThis.fetch;

export async function makeEnv() {
  const pg = new PGlite();
  await pg.exec(MIGRATION);
  const db = {
    query: async (t, p = []) => (await pg.query(t, p)).rows,
    tx: (fn) => pg.transaction((tx) => fn({ query: async (t, p = []) => (await tx.query(t, p)).rows }))
  };
  const blobs = new Map();
  const store = {
    set: async (k, v) => { blobs.set(k, Buffer.from(v)); },
    get: async (k, opts) => { const v = blobs.get(k); if (!v) return null; if (opts && opts.type === 'arrayBuffer') return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength); return v.toString(); },
    delete: async (k) => { blobs.delete(k); }
  };
  const state = { current: null, identityUsers: [], deleted: [], disableSignup: true, invites: [], inviteResult: { ok: true }, sheet: { quotes: [], contacts: [], updates: [], fail: false } };
  const identity = {
    getUser: async () => state.current,
    verifyRequestOrigin: (req) => { const o = req.headers.get('origin'); if (!o || o !== new URL(req.url).origin) throw new Error('bad origin'); },
    getIdentityConfig: () => ({ url: 'https://id.test/.netlify/identity', token: 'operator-token' }),
    getSettings: async () => ({ disableSignup: state.disableSignup }),
    admin: { listUsers: async () => state.identityUsers, deleteUser: async (id) => { state.deleted.push(id); state.identityUsers = state.identityUsers.filter((u) => u.id !== id); } }
  };
  globalThis.__FCV_TEST__ = { db, blobs: store, identity };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://id.test/.netlify/identity/invite')) {
      const body = JSON.parse(opts.body); state.invites.push(body.email); if (state.onInvite) state.onInvite(body.email);
      return state.inviteResult.ok ? new Response('{}', { status: 200 }) : new Response(JSON.stringify({ msg: state.inviteResult.msg || 'nope' }), { status: state.inviteResult.status || 422 });
    }
    if (u === 'https://script.test/exec') {
      const body = JSON.parse(opts.body);
      if (body.serviceKey !== 'svc-key') return new Response(JSON.stringify({ ok: false, error: 'bad key' }));
      if (state.sheet.fail) return new Response(JSON.stringify({ ok: false, error: 'sheet down' }));
      if (body.action === 'svc_list') return new Response(JSON.stringify({ ok: true, quotes: state.sheet.quotes, contacts: state.sheet.contacts, statusOptions: ['New', 'Contacted'] }));
      if (body.action === 'svc_update') { state.sheet.updates.push(body); return new Response(JSON.stringify({ ok: true, record: { Reference: body.ref, ...body.fields } })); }
    }
    return realFetch(url, opts);
  };
  const { default: handler } = await import('../netlify/functions/api.mjs');
  const ctx = { ip: '203.0.113.9', deploy: { context: 'deploy-preview' } };

  // Make a request as a given signed-in person (null = nobody signed in).
  async function call(as, method, p, body, { origin = ORIGIN, headers = {} } = {}) {
    state.current = as ? { id: 'id-' + as, email: as, name: as.split('@')[0] } : null;
    const init = { method, headers: { ...(origin ? { origin } : {}), ...headers } };
    if (body !== undefined) { if (!init.headers['content-type']) init.headers['content-type'] = 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body); }
    const res = await handler(new Request(ORIGIN + p, init), ctx);
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, json: ct.includes('json') ? await res.clone().json() : null, res };
  }
  const q = (t, p) => db.query(t, p);
  return { pg, db, store, blobs, state, call, q, handler, ctx, close: () => { globalThis.fetch = realFetch; delete globalThis.__FCV_TEST__; } };
}

export async function invite(env, email, projectIds = []) {
  const r = await env.call(ADMIN, 'POST', '/api/admin/invite', { email, projectIds });
  if (r.status !== 201) throw new Error('invite failed ' + JSON.stringify(r.json));
  return r.json;
}
export async function mkProject(env, over = {}) {
  const r = await env.call(ADMIN, 'POST', '/api/projects', { code: 'PRJ-' + Math.random().toString(36).slice(2, 7).toUpperCase(), title: 'Garage studio', clientName: 'Maria Client', ...over });
  if (r.status !== 201) throw new Error('mkProject failed ' + JSON.stringify(r.json));
  return r.json.project;
}
export const pdf = (extra = '') => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n' + extra + '\n%%EOF');
export const b64 = (buf) => Buffer.from(buf).toString('base64');
