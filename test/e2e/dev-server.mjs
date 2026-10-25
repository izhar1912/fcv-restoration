// TEST ONLY. Runs the real API function against a real Postgres (PGlite) with a stand-in for Netlify Identity,
// seeded with the real Medinah workbook plus clearly fake DEMO data for screenshots and browser tests.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeEnv, ADMIN, b64, pdf } from '../harness.mjs';
import { parseWorkbook, commitImport } from '../../netlify/lib/xlsx-import.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8765);
export const PASSWORDS = { [ADMIN]: 'AdminPass#2026', 'maria@client.test': 'MariaPass#2026', 'lender@bank.test': 'LenderPass#2026' };

export async function startDevServer({ port = PORT, seed = true } = {}) {
  const env = await makeEnv();
  const accounts = new Map(); // email -> {id, password, name}
  const invites = new Map(); const recoveries = new Map(); const sentInvites = [];
  for (const [e, p] of Object.entries(PASSWORDS)) accounts.set(e, { id: 'u-' + e, password: p, name: e === ADMIN ? 'Owner' : '' });
  env.state.onInvite = (email) => { const t = crypto.randomBytes(12).toString('hex'); invites.set(t, email); sentInvites.push({ email, token: t }); };
  env.state.sheet.quotes = [
    { Reference: 'FCV-Q-0021', 'Submitted At': new Date(Date.now() - 3600e3).toISOString(), Name: 'Priya Shah', Phone: '(312) 555-0123', Email: 'priya@example.com', 'Property Address': '9 Lake Rd', City: 'Highland Park', ZIP: '60035', 'Property Type': 'Home I live in', 'Finish Level': 'Premium', 'Start Timeline': 'Within 3 months', 'Insurance Claim': 'No', Notes: 'Kitchen and one bathroom.', 'Selected Items': 'Kitchen remodel (180 sq ft); Bathroom remodel (60 sq ft)', 'Site-Visit Items': 'Structural review', 'Item Count': 3, 'Estimate Low': 62000, 'Estimate High': 94000, 'Estimate Range (shown to customer)': '$62,000 - $94,000', 'Quote Status': 'New', 'Actual Price': '', 'Internal Notes': '', 'Work Start Date': '', 'Client Message': '' },
    { Reference: 'FCV-Q-0020', 'Submitted At': new Date(Date.now() - 30 * 3600e3).toISOString(), Name: 'Marcus Alvarez', Phone: '(847) 555-0199', Email: 'marcus@example.com', 'Property Address': '88 Oak Ave', City: 'Northbrook', ZIP: '60062', 'Property Type': 'Rental property', 'Finish Level': 'Standard', 'Start Timeline': 'ASAP', 'Insurance Claim': 'Yes', Notes: 'Water damage after a pipe burst.', 'Selected Items': 'Drywall repair (400 sq ft); Flooring (600 sq ft)', 'Site-Visit Items': '', 'Item Count': 2, 'Estimate Low': 9800, 'Estimate High': 16400, 'Estimate Range (shown to customer)': '$9,800 - $16,400', 'Quote Status': 'Contacted', 'Actual Price': '', 'Internal Notes': 'Left a voicemail.', 'Work Start Date': '', 'Client Message': '' }
  ];
  env.state.sheet.contacts = [{ Reference: 'FCV-C-0003', 'Submitted At': new Date().toISOString(), Name: 'John Smith', Phone: '(847) 555-0100', Email: 'john@example.com', Subject: 'Restoration', Message: 'Pipe burst last night.', 'Quote Status': 'New' }];

  const call = env.call;
  const hasAccepted = (e) => accounts.has(e);

  if (seed) {
    await call(ADMIN, 'GET', '/api/me');
    for (const m of ['maria@client.test', 'lender@bank.test', 'bob@client.test']) await call(ADMIN, 'POST', '/api/admin/invite', { email: m, name: m.startsWith('maria') ? 'Maria Santos' : m.startsWith('lender') ? 'Dana Whitfield' : '' });
    sentInvites.length = 0;
    await env.q("UPDATE portal_users SET status='active', identity_id='u-x' WHERE email IN ('maria@client.test','lender@bank.test')");
    const wb = fs.existsSync('/mnt/user-data/uploads/FCV_Medinah_Taiwo_Member_Portal_Admin_Tracker_37582-89.xlsx') ? fs.readFileSync('/mnt/user-data/uploads/FCV_Medinah_Taiwo_Member_Portal_Admin_Tracker_37582-89.xlsx') : null;
    let medinah = null;
    if (wb) { const parsed = await parseWorkbook(wb); medinah = await commitImport(env.db, { email: ADMIN, role: 'admin', ip: '127.0.0.1' }, parsed, { stage: 'quote_sent', trackerVisible: true }); await call(ADMIN, 'POST', `/api/projects/${medinah.id}/members`, { email: 'maria@client.test' }); await call(ADMIN, 'POST', `/api/projects/${medinah.id}/members`, { email: 'lender@bank.test' }); }
    // ---- DEMO ONLY (fictional): a job in progress, so every tab has something to show ----
    const demo = (await call(ADMIN, 'POST', '/api/projects', { code: 'DEMO-KB-02', title: 'Kitchen & bath remodel', clientName: 'Demo Client', address: '55 Sample Lane, Evanston, IL 60201', stage: 'work_in_progress', baseEstimateCents: 8420000, lenderStatus: 'Lender-approved', estimateSource: 'Provided by contractor', workStartDate: '2026-10-05', clientMessage: 'Demolition is complete and framing starts Monday. Photos are on their way.', notes: ['Cabinet delivery depends on the supplier schedule.'] })).json.project;
    await call(ADMIN, 'POST', `/api/projects/${demo.id}/members`, { email: 'maria@client.test' });
    for (const [c, cat, q, u, un, w, bs] of [['M-01', 'Framing lumber', '120', 'pcs', 842, '8', 'Takeoff'], ['M-02', 'Drywall sheets', '64', 'sheets', 1495, '10', 'Takeoff'], ['M-03', 'Cabinetry allowance', '1', 'lot', 1850000, '0', 'Vendor quote'], ['M-04', 'Tile & underlayment', '240', 'sq ft', 1180, '12', 'Vendor quote'], ['M-05', 'Plumbing fixtures', '1', 'lot', 640000, '0', 'Allowance']]) await call(ADMIN, 'POST', `/api/projects/${demo.id}/budget-lines`, { code: c, category: cat, quantity: q, unit: u, unitPriceCents: un, wastePercent: w, basis: bs });
    const e1 = (await call(ADMIN, 'POST', `/api/projects/${demo.id}/expenses`, { purchasedOn: '2026-10-06', vendor: 'Lakeview Lumber', budgetCategory: 'Framing lumber', description: 'Framing package', amountCents: 118420, receiptRef: 'INV-88213' })).json.record;
    const e2 = (await call(ADMIN, 'POST', `/api/projects/${demo.id}/expenses`, { purchasedOn: '2026-10-09', vendor: 'North Shore Supply', budgetCategory: 'Drywall sheets', description: 'Drywall, 64 sheets', amountCents: 112300 })).json.record;
    await call(ADMIN, 'POST', `/api/projects/${demo.id}/documents`, { title: 'Lakeview Lumber invoice', kind: 'receipt', fileName: 'lakeview-inv-88213.pdf', dataBase64: b64(pdf('demo')), linkedType: 'expense', linkedId: e1.id });
    const sp = (await call(ADMIN, 'POST', `/api/projects/${demo.id}/supplements`, { scope: 'Relocate plumbing stack to island', vendorTrade: 'Plumbing', amountCents: 385000, status: 'Draft' })).json.record;
    await call(ADMIN, 'PATCH', `/api/projects/${demo.id}/supplements/${sp.id}`, { status: 'Approved', requestedOn: '2026-10-08', approvalEvidence: 'Approved in writing by lender (D. Whitfield), 10/10. Signed change order filed.' });
    await call(ADMIN, 'POST', `/api/projects/${demo.id}/supplements`, { scope: 'Upgrade to quartz countertops', vendorTrade: 'Countertops', amountCents: 520000, status: 'Submitted', requestedOn: '2026-10-12' });
    const d1 = (await call(ADMIN, 'POST', `/api/projects/${demo.id}/draws`, { purpose: 'Initial materials', amountRequestedCents: 2500000, status: 'Proposed - not submitted' })).json.record;
    await call(ADMIN, 'PATCH', `/api/projects/${demo.id}/draws/${d1.id}`, { status: 'Partially funded', requestedOn: '2026-10-02', amountApprovedCents: 2200000, amountDisbursedCents: 1500000, notes: 'Lender funded $15,000 on 10/05; balance on inspection.' });
    await call(ADMIN, 'POST', `/api/projects/${demo.id}/draws`, { purpose: 'Rough-in complete', amountRequestedCents: 1800000, status: 'Submitted', requestedOn: '2026-10-14' });
    await call(ADMIN, 'POST', `/api/projects/${demo.id}/remaining-items`, { category: 'Electrical', amountCents: 780000, note: 'Quote #E-114' });
    await call(ADMIN, 'POST', `/api/projects/${demo.id}/remaining-items`, { category: 'Painting & finish', amountCents: 420000, note: 'Signed scope' });
    await call(ADMIN, 'POST', `/api/projects/${demo.id}/documents`, { title: 'Signed contract', kind: 'contract', fileName: 'contract.pdf', dataBase64: b64(pdf('contract')) });
    const early = (await call(ADMIN, 'POST', '/api/projects', { code: 'DEMO-GS-03', title: 'Garage conversion', clientName: 'Demo Client', address: '12 Example Ct, Skokie, IL 60076', stage: 'site_visit', clientMessage: 'Our estimator will visit Tuesday at 10am. Please make sure the garage is accessible.' })).json.project;
    await call(ADMIN, 'POST', `/api/projects/${early.id}/members`, { email: 'maria@client.test' });
  }

  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
  const cookie = (req, n) => { const m = new RegExp('(?:^|; )' + n + '=([^;]*)').exec(req.headers.cookie || ''); return m ? m[1] : ''; };
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'Cache-Control': 'no-store', ...headers }); res.end(body); };
  const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json' });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      let p = url.pathname;
      if (p.startsWith('/__mock/')) {
        const body = JSON.parse((await readBody(req)).toString() || '{}'); const op = p.slice(8);
        const mk = (email) => { const a = accounts.get(email); return { user: { id: a.id, email, name: a.name || '', roles: [] }, token: Buffer.from(email).toString('base64url') }; };
        if (op === 'login') { const a = accounts.get(String(body.email).toLowerCase()); if (!a || a.password !== body.password) return sendJson(res, 401, { error: 'Invalid credentials' }); return sendJson(res, 200, mk(String(body.email).toLowerCase())); }
        if (op === 'accept') { const email = invites.get(body.token); if (!email) return sendJson(res, 400, { error: 'Invite expired' }); invites.delete(body.token); accounts.set(email, { id: 'u-' + email, password: body.password, name: '' }); return sendJson(res, 200, mk(email)); }
        if (op === 'request-recovery') { const e = String(body.email).toLowerCase(); if (accounts.has(e)) { const t = crypto.randomBytes(8).toString('hex'); recoveries.set(t, e); sentInvites.push({ email: e, token: t, recovery: true }); } return sendJson(res, 200, {}); }
        if (op === 'recovery') { const e = recoveries.get(body.token); if (!e) return sendJson(res, 400, { error: 'Link expired' }); recoveries.delete(body.token); return sendJson(res, 200, mk(e)); }
        if (op === 'update-password') { const e = Buffer.from(cookie(req, 'nf_jwt'), 'base64url').toString(); if (!accounts.has(e)) return sendJson(res, 401, {}); accounts.get(e).password = body.password; return sendJson(res, 200, mk(e)); }
        if (op === 'last-invite') return sendJson(res, 200, sentInvites.filter((x) => !body.email || x.email === body.email).at(-1) || null);
        if (op === 'state') return sendJson(res, 200, { sheetUpdates: env.state.sheet.updates });
        return sendJson(res, 404, {});
      }
      if (p.startsWith('/api/')) {
        const buf = await readBody(req);
        const email = cookie(req, 'nf_jwt') ? Buffer.from(cookie(req, 'nf_jwt'), 'base64url').toString() : null;
        env.state.current = email && accounts.has(email) ? { id: accounts.get(email).id, email, name: accounts.get(email).name } : null;
        const headers = {}; for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
        const r = await env.handler(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : buf }), env.ctx);
        const out = Buffer.from(await r.arrayBuffer()); const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
        return send(res, r.status, out, h);
      }
      if (p === '/portal/assets/identity.js') return send(res, 200, fs.readFileSync(path.join(root, 'test/e2e/.built/identity.js')), { 'Content-Type': types['.js'] });
      if (p.startsWith('/Images/')) { const f = path.join(root, 'test/e2e/images', decodeURIComponent(p.slice(8))); return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), { 'Content-Type': types['.png'] }) : send(res, 404, 'no'); }
      if (p === '/') p = '/portal/index.html'; if (p.endsWith('/')) p += 'index.html'; else if (!path.extname(p)) p += '/index.html';
      const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, 'Not found');
      const csp = /Content-Security-Policy = "([^"]+)"/.exec(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8'));
      const sec = (p.startsWith('/portal/') || p.startsWith('/admin/')) && csp ? { 'Content-Security-Policy': csp[1] } : {};
      return send(res, 200, fs.readFileSync(f), { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', ...sec });
    } catch (e) { console.error(e); send(res, 500, String(e.message)); }
  });
  await new Promise((r) => server.listen(port, r));
  return { env, server, port, close: () => new Promise((r) => { server.close(r); env.close(); }), hasAccepted, accounts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { const s = await startDevServer(); console.log('FCV portal test server on http://localhost:' + s.port); }
