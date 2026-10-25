import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeEnv, invite, mkProject, ADMIN, pdf, b64 } from './harness.mjs';

const MARIA = 'maria@client.test';
const WORKBOOK = '/mnt/user-data/uploads/FCV_Medinah_Taiwo_Member_Portal_Admin_Tracker_37582-89.xlsx';
const UUID0 = '00000000-0000-4000-8000-000000000000';
const post = (env, p, b) => env.call(ADMIN, 'POST', p, b);
const patch = (env, p, b) => env.call(ADMIN, 'PATCH', p, b);

describe('importing the real FCV workbook (Medinah Taiwo)', () => {
  let env, project, b64wb; before(async () => {
    env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me');
    b64wb = b64(fs.readFileSync(WORKBOOK));
  }); after(() => env.close());

  it('preview shows the workbook cross-checks and what will NOT be imported', async () => {
    const r = await post(env, '/api/admin/import/preview', { dataBase64: b64wb });
    assert.equal(r.status, 200);
    assert.ok(r.json.report.checks.length >= 3 && r.json.report.checks.every((c) => c.ok), JSON.stringify(r.json.report.checks));
    assert.equal(r.json.project.code, 'FCV-MT-ADU-01'); assert.equal(r.json.project.clientName, 'Medinah Taiwo');
    assert.equal(r.json.expenses.length, 0); assert.equal(r.json.supplements.length, 0);
    const kept = r.json.project.notes.join(' | ');
    assert.match(kept, /UNVERIFIED/); assert.match(kept, /provisional/); assert.match(kept, /lender approval/);
    assert.doesNotMatch(kept, /\$|portal|website|have been entered|workbook/i, 'no stale or self-referential sentences are imported');
    assert.ok(r.json.report.skippedNotes.length >= 4);
    assert.equal((await env.q('SELECT count(*)::int n FROM projects'))[0].n, 0, 'preview writes nothing');
  });
  it('rejects things that are not the workbook', async () => {
    assert.equal((await post(env, '/api/admin/import/preview', { dataBase64: b64('hello world') })).status, 400);
    assert.equal((await post(env, '/api/admin/import/preview', {})).status, 400);
    assert.equal((await post(env, '/api/admin/import/preview', { dataBase64: b64(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('garbage')])) })).status, 400);
  });
  it("commit creates Medinah's project with exactly the workbook's figures", async () => {
    const r = await post(env, '/api/admin/import/commit', { dataBase64: b64wb, overrides: { stage: 'quote_sent', trackerVisible: true } });
    assert.equal(r.status, 201); project = r.json.project;
    const b = (await env.call(ADMIN, 'GET', `/api/projects/${project.id}`)).json;
    const s = b.tracker.summary;
    assert.equal(s.baseEstimateCents, 3758289, 'total estimate $37,582.89');
    assert.equal(s.phase1TotalCents, 1200000, 'initial draw / Phase 1 materials $12,000.00');
    assert.equal(s.remainingBaseCents, 2558289, 'remaining base budget $25,582.89');
    assert.ok(Math.abs(s.initialDrawShare - 0.319294) < 1e-5, '31.93%');
    assert.equal(s.approvedSupplementsCents, 0); assert.equal(s.revisedBudgetCents, 3758289);
    assert.equal(s.expensesCents, 0); assert.equal(s.budgetLessExpensesCents, 3758289);
    assert.equal(s.draws.requestedCents, 1200000); assert.equal(s.draws.approvedCents, 0); assert.equal(s.draws.disbursedCents, 0);
    assert.equal(s.balanceToItemizeCents, 2558289); assert.equal(s.itemizedRemainingCents, 0);
    assert.equal(b.tracker.budgetLines.length, 12);
    const flooring = b.tracker.budgetLines.find((l) => /floor/i.test(l.category));
    assert.equal(flooring.extendedCents, 197340, '600 sq ft x $2.99 + 10% waste, to the cent');
    assert.equal(b.tracker.expenses.length, 0, 'no expenses invented'); assert.equal(b.tracker.supplements.length, 0, 'no supplements invented');
    assert.equal(b.tracker.draws.length, 1);
    assert.equal(b.tracker.draws[0].status, 'Proposed - not submitted'); assert.equal(b.tracker.draws[0].amountApprovedCents, null); assert.equal(b.tracker.draws[0].amountDisbursedCents, null);
    assert.equal(b.project.lenderStatus, 'Preliminary / not lender-approved');
  });
  it('the assigned member sees the same numbers, read-only', async () => {
    await invite(env, MARIA, [project.id]); await env.call(MARIA, 'GET', '/api/me');
    const b = (await env.call(MARIA, 'GET', `/api/projects/${project.id}`)).json;
    assert.equal(b.tracker.summary.baseEstimateCents, 3758289); assert.equal(b.permissions.canEdit, false);
    const card = (await env.call(MARIA, 'GET', '/api/projects')).json.projects[0];
    assert.equal(card.summary.phase1TotalCents, 1200000);
  });
  it('importing the same project twice is refused (project code is unique)', async () => {
    const r = await post(env, '/api/admin/import/commit', { dataBase64: b64wb });
    assert.equal(r.status, 409);
    assert.equal((await env.q('SELECT count(*)::int n FROM projects'))[0].n, 1, 'nothing partial was left behind');
    assert.equal((await env.q('SELECT count(*)::int n FROM budget_lines'))[0].n, 12);
  });
  it('the import is fully audited', async () => {
    const rows = await env.q("SELECT action, count(*)::int n FROM audit_log WHERE project_id = $1 GROUP BY action", [project.id]);
    const m = Object.fromEntries(rows.map((r) => [r.action, r.n]));
    assert.equal(m['project.create'], 1); assert.equal(m['budget_line.create'], 12); assert.equal(m['draw.create'], 1); assert.equal(m['project.import'], 1);
  });
});

describe('the money rules', () => {
  let env, P; before(async () => { env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me'); P = await mkProject(env, { baseEstimateCents: 3758289, stage: 'work_in_progress' }); }); after(() => env.close());
  const sum = async () => (await env.call(ADMIN, 'GET', `/api/projects/${P.id}`)).json.tracker.summary;
  const supp = (o) => ({ scope: 'Extra framing', amountCents: 500000, status: 'Draft', ...o });

  it('only an Approved supplement changes the budget, and approval needs proof', async () => {
    const d = await post(env, `/api/projects/${P.id}/supplements`, supp({}));
    assert.equal(d.status, 201); assert.equal(d.json.record.supplementRef, 'SUP-001');
    assert.equal((await sum()).revisedBudgetCents, 3758289, 'a draft does not count');
    const sub = await patch(env, `/api/projects/${P.id}/supplements/${d.json.record.id}`, { status: 'Submitted' });
    assert.equal(sub.status, 400); assert.ok(sub.json.error.details.requestedOn);
    await patch(env, `/api/projects/${P.id}/supplements/${d.json.record.id}`, { status: 'Submitted', requestedOn: '2026-10-10' });
    assert.equal((await sum()).revisedBudgetCents, 3758289, 'submitted does not count');
    const noProof = await patch(env, `/api/projects/${P.id}/supplements/${d.json.record.id}`, { status: 'Approved' });
    assert.equal(noProof.status, 400); assert.ok(noProof.json.error.details.approvalEvidence);
    assert.equal((await sum()).revisedBudgetCents, 3758289);
    const ok = await patch(env, `/api/projects/${P.id}/supplements/${d.json.record.id}`, { status: 'Approved', approvalEvidence: 'Signed by lender J. Doe 10/12, filed in Drive /Approvals' });
    assert.equal(ok.status, 200); assert.ok(ok.json.record.approvedOn);
    const s = await sum(); assert.equal(s.approvedSupplementsCents, 500000); assert.equal(s.revisedBudgetCents, 4258289);
    await patch(env, `/api/projects/${P.id}/supplements/${d.json.record.id}`, { status: 'Withdrawn' });
    const s2 = await sum(); assert.equal(s2.revisedBudgetCents, 3758289, 'withdrawn is removed again'); 
    assert.equal((await env.call(ADMIN, 'GET', `/api/projects/${P.id}`)).json.tracker.supplements[0].approvedOn, null);
  });
  it('expenses: auto IDs, totals, no future dates, unique IDs', async () => {
    const e1 = await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-05', vendor: 'Lumber Co', description: '2x4 studs', amountCents: 123456 });
    const e2 = await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-06', vendor: 'Paint Pro', description: 'Primer', amountCents: 7544 });
    assert.equal(e1.json.record.expenseRef, 'EXP-001'); assert.equal(e2.json.record.expenseRef, 'EXP-002');
    const s = await sum(); assert.equal(s.expensesCents, 131000); assert.equal(s.budgetLessExpensesCents, 3758289 - 131000);
    assert.equal((await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2999-01-01', vendor: 'x', description: 'x', amountCents: 100 })).status, 400);
    assert.equal((await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-05', vendor: 'x', description: 'x', amountCents: 100, expenseRef: 'EXP-001' })).status, 409);
    for (const bad of [0, -5, 1.5, '12.50', 'abc', 1e15, null]) {
      assert.equal((await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-05', vendor: 'x', description: 'x', amountCents: bad })).status, 400, `amount ${bad}`);
    }
    assert.equal((await sum()).counts.expenses, 2, 'nothing was saved by the rejected attempts');
  });
  it('draws keep requested, approved and disbursed separate', async () => {
    const d = await post(env, `/api/projects/${P.id}/draws`, { purpose: 'Initial materials', amountRequestedCents: 1200000, status: 'Proposed - not submitted' });
    assert.equal(d.status, 201); assert.equal(d.json.record.drawRef, 'DRAW-001'); const url = `/api/projects/${P.id}/draws/${d.json.record.id}`;
    assert.equal((await patch(env, url, { amountApprovedCents: 1200000 })).status, 400, 'cannot pre-fill approved');
    assert.equal((await patch(env, url, { status: 'Submitted' })).status, 400, 'submitted needs a date');
    assert.equal((await patch(env, url, { status: 'Submitted', requestedOn: '2026-10-12' })).status, 200);
    assert.equal((await patch(env, url, { status: 'Approved' })).status, 400, 'approved needs an approved amount');
    assert.equal((await patch(env, url, { status: 'Approved', amountApprovedCents: 1000000 })).status, 200);
    assert.equal((await patch(env, url, { status: 'Funded', amountDisbursedCents: 1000000 })).status, 200);
    assert.equal((await patch(env, url, { amountDisbursedCents: 1100000 })).status, 400, 'cannot pay more than approved');
    assert.equal((await patch(env, url, { status: 'Funded', amountDisbursedCents: 900000 })).status, 400, 'Funded means the full amount');
    assert.equal((await patch(env, url, { status: 'Partially funded', amountDisbursedCents: 900000 })).status, 200);
    const s = await sum(); assert.deepEqual(s.draws, { requestedCents: 1200000, approvedCents: 1000000, disbursedCents: 900000 });
    assert.equal((await patch(env, url, { status: 'Rejected' })).status, 400, 'rejected cannot keep approved/disbursed amounts');
  });
  it('budget lines are exact to the cent, and bad numbers are refused', async () => {
    const l = await post(env, `/api/projects/${P.id}/budget-lines`, { code: 'M-1', category: 'Flooring', quantity: '600', unit: 'sq ft', unitPriceCents: 299, wastePercent: '10' });
    assert.equal(l.status, 201); assert.equal(l.json.record.extendedCents, 197340);
    const odd = await post(env, `/api/projects/${P.id}/budget-lines`, { category: 'Odd', quantity: '3.333', unit: 'ea', unitPriceCents: 1999, wastePercent: '7.5' });
    assert.equal(odd.json.record.extendedCents, Math.round(3.333 * 1999 * 1.075));
    for (const bad of [{ quantity: '-1' }, { quantity: 'abc' }, { quantity: '1.2345' }, { wastePercent: '101' }, { unitPriceCents: -1 }, { category: '' }]) {
      assert.equal((await post(env, `/api/projects/${P.id}/budget-lines`, { category: 'x', quantity: '1', unit: 'ea', unitPriceCents: 100, ...bad })).status, 400, JSON.stringify(bad));
    }
  });
  it("records cannot be changed through another project's URL", async () => {
    const other = await mkProject(env);
    const e = await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-07', vendor: 'v', description: 'd', amountCents: 100 });
    assert.equal((await patch(env, `/api/projects/${other.id}/expenses/${e.json.record.id}`, { vendor: 'hijack' })).status, 404);
    assert.equal((await env.call(ADMIN, 'DELETE', `/api/projects/${other.id}/expenses/${e.json.record.id}`, {})).status, 404);
    assert.equal((await env.q('SELECT vendor FROM expenses WHERE id = $1', [e.json.record.id]))[0].vendor, 'v');
  });
  it('remaining-amount items feed the Contract Overview balance', async () => {
    const before = (await sum()).balanceToItemizeCents;
    await post(env, `/api/projects/${P.id}/remaining-items`, { category: 'Electrical', amountCents: 450000, note: 'Quote #12' });
    assert.equal((await sum()).balanceToItemizeCents, before - 450000);
  });
});

describe('audit history', () => {
  let env, P; before(async () => { env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me'); P = await mkProject(env); }); after(() => env.close());
  const audit = async (q = '') => (await env.call(ADMIN, 'GET', `/api/admin/audit?project=${P.id}${q}`)).json;

  it('records who, what, before and after for create, edit and delete', async () => {
    const e = await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-05', vendor: 'A', description: 'd', amountCents: 1000 });
    await patch(env, `/api/projects/${P.id}/expenses/${e.json.record.id}`, { amountCents: 2500, vendor: 'B' });
    await env.call(ADMIN, 'DELETE', `/api/projects/${P.id}/expenses/${e.json.record.id}`, {});
    const a = (await audit('&action=expense')).entries.reverse();
    assert.deepEqual(a.map((x) => x.action), ['expense.create', 'expense.update', 'expense.delete']);
    assert.equal(a[0].actor, ADMIN); assert.equal(a[0].after.amountCents, 1000);
    assert.deepEqual(a[1].before, { vendor: 'A', amountCents: 1000 }); assert.deepEqual(a[1].after, { vendor: 'B', amountCents: 2500 });
    assert.equal(a[2].before.amountCents, 2500, 'a deleted record is preserved in the history');
    assert.ok(a[0].ip && a[0].at);
  });
  it('failed or invalid requests leave no half-done change and no phantom history', async () => {
    const n = async () => ({ a: (await env.q('SELECT count(*)::int n FROM audit_log'))[0].n, s: (await env.q('SELECT count(*)::int n FROM supplements'))[0].n });
    await post(env, `/api/projects/${P.id}/supplements`, { scope: 'One', amountCents: 100, status: 'Draft', supplementRef: 'SUP-X' });
    const before = await n();
    assert.equal((await post(env, `/api/projects/${P.id}/supplements`, { scope: 'Dup', amountCents: 100, status: 'Draft', supplementRef: 'SUP-X' })).status, 409);
    assert.equal((await post(env, `/api/projects/${P.id}/supplements`, { scope: '', amountCents: -1, status: 'Nope' })).status, 400);
    assert.deepEqual(await n(), before);
  });
  it('history cannot be edited or erased, even with direct database access', async () => {
    for (const sql of ['UPDATE audit_log SET summary = $1', 'DELETE FROM audit_log WHERE id > 0 OR $1 = $1', 'TRUNCATE audit_log']) {
      await assert.rejects(env.q(sql, sql.includes('$1') ? ['x'] : []), /append-only/);
    }
  });
  it('is paginated, filterable, and admin-only; downloads are recorded too', async () => {
    for (let i = 0; i < 5; i++) await post(env, `/api/projects/${P.id}/remaining-items`, { category: 'C' + i, amountCents: 100 });
    const p1 = await audit('&limit=3'); assert.equal(p1.entries.length, 3); assert.ok(p1.next);
    const p2 = await audit(`&limit=3&before=${p1.next}`); assert.ok(p2.entries[0].id < p1.entries.at(-1).id || p2.entries[0].id === String(Number(p1.next) - 1) || Number(p2.entries[0].id) < Number(p1.next));
    const up = await post(env, `/api/projects/${P.id}/documents`, { title: 'Doc', kind: 'supporting', fileName: 'd.pdf', dataBase64: b64(pdf()) });
    await env.call(ADMIN, 'GET', `/api/documents/${up.json.document.id}/download`);
    const acts = (await audit('&action=document')).entries.map((x) => x.action);
    assert.ok(acts.includes('document.upload') && acts.includes('document.download'));
    await invite(env, MARIA); await env.call(MARIA, 'GET', '/api/me');
    assert.equal((await env.call(MARIA, 'GET', '/api/admin/audit')).status, 403);
  });
});

describe('receipts and supporting documents', () => {
  let env, P; before(async () => { env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me'); P = await mkProject(env, { stage: 'work_in_progress' }); await invite(env, MARIA, [P.id]); await env.call(MARIA, 'GET', '/api/me'); }); after(() => env.close());
  const upload = (o) => post(env, `/api/projects/${P.id}/documents`, { title: 'Receipt', kind: 'receipt', fileName: 'receipt.pdf', dataBase64: b64(pdf('hello-bytes')), ...o });

  it('stores a real PDF privately and serves it back byte-for-byte with safe headers', async () => {
    const r = await upload({}); assert.equal(r.status, 201);
    const id = r.json.document.id;
    assert.equal((await env.q('SELECT blob_key FROM documents WHERE id = $1', [id])).length, 1);
    const dl = await env.call(MARIA, 'GET', `/api/documents/${id}/download`);
    assert.equal(dl.status, 200);
    assert.deepEqual(Buffer.from(await dl.res.arrayBuffer()), pdf('hello-bytes'));
    assert.match(dl.headers.get('content-disposition'), /^attachment;/); assert.equal(dl.headers.get('content-type'), 'application/pdf');
    assert.equal(dl.headers.get('x-content-type-options'), 'nosniff'); assert.match(dl.headers.get('cache-control'), /no-store/); assert.match(dl.headers.get('content-security-policy'), /sandbox/);
  });
  it('refuses disguised, dangerous, empty and oversized files', async () => {
    assert.equal((await upload({ dataBase64: b64('<script>alert(1)</script>') })).status, 400, 'text pretending to be a PDF');
    assert.equal((await upload({ fileName: 'virus.exe', dataBase64: b64('MZ') })).status, 400);
    assert.equal((await upload({ fileName: 'page.html', dataBase64: b64('<html>') })).status, 400);
    assert.equal((await upload({ fileName: 'x.png', dataBase64: b64(pdf()) })).status, 400, 'a PDF renamed to .png');
    assert.equal((await upload({ dataBase64: '' })).status, 400);
    assert.equal((await upload({ dataBase64: b64(Buffer.concat([pdf(), Buffer.alloc(4 * 1024 * 1024)])) })).status, 413);
    assert.equal((await upload({ kind: 'bomb' })).status, 400);
    assert.equal((await env.q('SELECT count(*)::int n FROM documents WHERE title = $1', ['Receipt']))[0].n, 1, 'only the one good file exists');
  });
  it('cleans file names and ignores the browser-claimed type', async () => {
    const r = await upload({ fileName: '../../etc/passwd.pdf', title: 'Path trick', contentType: 'text/html' });
    assert.equal(r.status, 201); assert.equal(r.json.document.fileName, 'passwd.pdf'); assert.equal(r.json.document.contentType, 'application/pdf');
  });
  it('can be attached to an expense on the same project only; deleting the expense keeps the evidence', async () => {
    const e = await post(env, `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-05', vendor: 'v', description: 'd', amountCents: 500 });
    const other = await mkProject(env); const oe = await post(env, `/api/projects/${other.id}/expenses`, { purchasedOn: '2026-10-05', vendor: 'v', description: 'd', amountCents: 500 });
    assert.equal((await upload({ title: 'Cross', linkedType: 'expense', linkedId: oe.json.record.id })).status, 400);
    assert.equal((await upload({ title: 'Bad id', linkedType: 'expense', linkedId: 'x; DROP TABLE' })).status, 400);
    const d = await upload({ title: 'Linked', linkedType: 'expense', linkedId: e.json.record.id }); assert.equal(d.status, 201);
    const view = (await env.call(MARIA, 'GET', `/api/projects/${P.id}`)).json.tracker.documents.find((x) => x.id === d.json.document.id);
    assert.equal(view.linkedId, e.json.record.id);
    const del = await env.call(ADMIN, 'DELETE', `/api/projects/${P.id}/expenses/${e.json.record.id}`, {});
    assert.equal(del.json.unlinkedDocuments, 1);
    assert.equal((await env.q('SELECT linked_id FROM documents WHERE id = $1', [d.json.document.id]))[0].linked_id, null);
    assert.equal((await env.call(ADMIN, 'GET', `/api/documents/${d.json.document.id}/download`)).status, 200);
  });
  it('a missing file is reported honestly, and deleting removes both the record and the file', async () => {
    const d = await upload({ title: 'Gone' }); const key = (await env.q('SELECT blob_key FROM documents WHERE id = $1', [d.json.document.id]))[0].blob_key;
    env.blobs.delete(key);
    assert.equal((await env.call(ADMIN, 'GET', `/api/documents/${d.json.document.id}/download`)).json.error.code, 'file_missing');
    const d2 = await upload({ title: 'Remove me' }); const k2 = (await env.q('SELECT blob_key FROM documents WHERE id = $1', [d2.json.document.id]))[0].blob_key;
    assert.ok(env.blobs.has(k2));
    assert.equal((await env.call(ADMIN, 'DELETE', `/api/documents/${d2.json.document.id}`, {})).status, 200);
    assert.ok(!env.blobs.has(k2)); assert.equal((await env.q('SELECT count(*)::int n FROM documents WHERE id = $1', [d2.json.document.id]))[0].n, 0);
  });
  it('deleting a project needs its code typed in, removes its files, and keeps the history', async () => {
    const q = await mkProject(env); const d = await post(env, `/api/projects/${q.id}/documents`, { title: 'T', kind: 'other', fileName: 't.txt', dataBase64: b64('hello') });
    const key = (await env.q('SELECT blob_key FROM documents WHERE id = $1', [d.json.document.id]))[0].blob_key;
    assert.equal((await env.call(ADMIN, 'DELETE', `/api/projects/${q.id}`, {})).status, 400);
    assert.equal((await env.call(ADMIN, 'DELETE', `/api/projects/${q.id}`, { confirmCode: 'WRONG' })).status, 400);
    assert.ok(env.blobs.has(key));
    assert.equal((await env.call(ADMIN, 'DELETE', `/api/projects/${q.id}`, { confirmCode: q.code.toLowerCase() })).status, 200);
    assert.ok(!env.blobs.has(key)); assert.equal((await env.q('SELECT count(*)::int n FROM documents WHERE project_id = $1', [q.id]))[0].n, 0);
    const hist = (await env.q("SELECT action FROM audit_log WHERE project_id = $1 ORDER BY id", [q.id])).map((r) => r.action);
    assert.ok(hist.includes('project.create') && hist.includes('project.delete'), 'history outlives the project');
    assert.equal((await env.call(MARIA, 'GET', `/api/projects/${q.id}`)).status, 404);
  });
});

describe('quote requests from the Google Sheet', () => {
  const QUOTE = { Reference: 'FCV-Q-0007', Name: 'Medinah Taiwo', Phone: '(312) 555-0147', Email: 'medinah@example.com', 'Property Address': '1020 Hill Avenue', City: 'Elgin', ZIP: '60120',
    'Selected Items': 'Basement finishing (800); Painting (1200)', 'Site-Visit Items': 'Bathroom', 'Estimate Range (shown to customer)': '$28,500 - $52,000', 'Property Type': 'Home',
    'Finish Level': 'Premium', 'Start Timeline': 'Within 1 month', 'Insurance Claim': 'No', Notes: 'Garage studio', 'Quote Status': 'Quote Sent', 'Actual Price': 34250, 'Work Start Date': '2026-11-03', 'Client Message': 'Hello' };
  let env; before(async () => { env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me'); env.state.sheet.quotes = [QUOTE]; }); after(() => env.close());

  it('lists requests and flags the ones already turned into projects', async () => {
    let r = await env.call(ADMIN, 'GET', '/api/admin/requests'); assert.equal(r.status, 200); assert.equal(r.json.quotes[0].project, null);
  });
  it('creates a project from a request without copying the customer\'s phone or email', async () => {
    const r = await post(env, '/api/admin/requests/FCV-Q-0007/project', { code: 'FCV-MT-ADU-01', title: 'Garage studio' });
    assert.equal(r.status, 201); const p = r.json.project;
    assert.equal(p.stage, 'quote_sent'); assert.equal(p.baseEstimateCents, 3425000); assert.equal(p.workStartDate, '2026-11-03'); assert.equal(p.requestRef, 'FCV-Q-0007'); assert.equal(r.json.clientEmail, 'medinah@example.com');
    assert.equal(p.address, '1020 Hill Avenue, Elgin, 60120'); assert.deepEqual(p.requestSnapshot.items, ['Basement finishing (800)', 'Painting (1200)']);
    const raw = JSON.stringify(await env.q('SELECT * FROM projects WHERE id = $1', [p.id]));
    assert.doesNotMatch(raw, /555-0147|medinah@example/);
    assert.equal((await post(env, '/api/admin/requests/FCV-Q-0007/project', { code: 'OTHER-1' })).status, 409, 'one project per request');
    assert.equal((await post(env, '/api/admin/requests/FCV-Q-9999/project', {})).status, 404);
    const l = await env.call(ADMIN, 'GET', '/api/admin/requests'); assert.equal(l.json.quotes[0].project.code, 'FCV-MT-ADU-01');
  });
  it('changing the project stage updates the sheet status; a sheet failure never blocks the portal', async () => {
    const p = (await env.q("SELECT id FROM projects WHERE code = 'FCV-MT-ADU-01'"))[0];
    let r = await patch(env, `/api/projects/${p.id}`, { stage: 'work_in_progress' });
    assert.equal(r.status, 200); assert.equal(r.json.sheetSync, 'synced');
    assert.deepEqual(env.state.sheet.updates.at(-1).fields, { 'Quote Status': 'Work in Progress' }); assert.equal(env.state.sheet.updates.at(-1).ref, 'FCV-Q-0007');
    env.state.sheet.fail = true;
    r = await patch(env, `/api/projects/${p.id}`, { stage: 'completed' });
    assert.equal(r.status, 200); assert.equal(r.json.sheetSync, 'failed'); assert.equal(r.json.project.stage, 'completed');
    assert.equal((await env.q("SELECT count(*)::int n FROM audit_log WHERE action = 'sheet.sync_failed'"))[0].n, 1);
    env.state.sheet.fail = false;
    const n = env.state.sheet.updates.length; await patch(env, `/api/projects/${p.id}`, { title: 'Renamed only' }); assert.equal(env.state.sheet.updates.length, n, 'no sheet call unless the stage changed');
  });
  it('only whitelisted request fields can be edited, and edits are audited', async () => {
    assert.equal((await patch(env, '/api/admin/requests/FCV-Q-0007', { tab: 'quote', row: 2, fields: { Reference: 'FCV-Q-0001' } })).status, 400);
    assert.equal((await patch(env, '/api/admin/requests/FCV-Q-0007', { tab: 'quote', row: 2, fields: { 'Tracking Token': 'x' } })).status, 400);
    assert.equal((await patch(env, '/api/admin/requests/FCV-Q-0007', { tab: 'quote', row: 2, fields: {} })).status, 400);
    const ok = await patch(env, '/api/admin/requests/FCV-Q-0007', { tab: 'quote', row: 2, fields: { 'Internal Notes': 'Called Tuesday' } });
    assert.equal(ok.status, 200); assert.equal((await env.q("SELECT count(*)::int n FROM audit_log WHERE action = 'request.update'"))[0].n, 1);
  });
  it('a missing connection is reported plainly', async () => {
    const k = process.env.FCV_SHEET_SERVICE_KEY; delete process.env.FCV_SHEET_SERVICE_KEY;
    const r = await env.call(ADMIN, 'GET', '/api/admin/requests'); process.env.FCV_SHEET_SERVICE_KEY = k;
    assert.equal(r.status, 503); assert.equal(r.json.error.code, 'sheet_not_configured');
  });
});
