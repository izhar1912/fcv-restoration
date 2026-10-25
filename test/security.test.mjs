import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, invite, mkProject, ADMIN, ORIGIN, pdf, b64 } from './harness.mjs';

const MARIA = 'maria@client.test', BOB = 'bob@client.test', LENDER = 'lender@bank.test';
const UUID0 = '00000000-0000-4000-8000-000000000000';
const counts = async (env) => (await env.q(`SELECT (SELECT count(*) FROM projects)::int p, (SELECT count(*) FROM expenses)::int e, (SELECT count(*) FROM supplements)::int s,
  (SELECT count(*) FROM draws)::int d, (SELECT count(*) FROM budget_lines)::int b, (SELECT count(*) FROM documents)::int doc, (SELECT count(*) FROM portal_users)::int u, (SELECT count(*) FROM project_members)::int m`))[0];

describe('authentication and roles', () => {
  let env; before(async () => { env = await makeEnv(); }); after(() => env.close());

  it('anonymous visitors are refused everywhere', async () => {
    for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/projects'], ['GET', `/api/projects/${UUID0}`], ['GET', `/api/documents/${UUID0}/download`], ['GET', '/api/admin/users'], ['GET', '/api/admin/audit'], ['POST', '/api/projects']]) {
      const r = await env.call(null, m, p, m === 'POST' ? {} : undefined);
      assert.equal(r.status, 401, `${m} ${p}`); assert.equal(r.json.error.code, 'not_signed_in');
    }
  });
  it('a signed-in person who was never invited gets nothing', async () => {
    const r = await env.call('stranger@evil.test', 'GET', '/api/projects');
    assert.equal(r.status, 403); assert.equal(r.json.error.code, 'not_invited');
    assert.equal((await env.q("SELECT count(*)::int n FROM portal_users WHERE email = 'stranger@evil.test'"))[0].n, 0);
  });
  it('the designated admin is created on first sign-in and the event is audited', async () => {
    const r = await env.call(ADMIN, 'GET', '/api/me');
    assert.equal(r.json.user.role, 'admin');
    assert.equal((await env.q("SELECT count(*)::int n FROM audit_log WHERE action = 'user.bootstrap_admin'"))[0].n, 1);
  });
  it('an invited member becomes active on first sign-in and is a member, never an admin', async () => {
    await invite(env, MARIA);
    assert.equal((await env.q('SELECT status FROM portal_users WHERE email = $1', [MARIA]))[0].status, 'invited');
    const r = await env.call(MARIA, 'GET', '/api/me');
    assert.equal(r.json.user.role, 'member');
    assert.equal((await env.q('SELECT status FROM portal_users WHERE email = $1', [MARIA]))[0].status, 'active');
  });
  it('a database row that says "admin" is not enough: the address must be the designated admin', async () => {
    await env.q("INSERT INTO portal_users (email, role, status) VALUES ('imposter@x.test','admin','active')");
    const r = await env.call('imposter@x.test', 'GET', '/api/admin/users');
    assert.equal(r.status, 403); assert.equal(r.json.error.code, 'admin_only');
    const me = await env.call('imposter@x.test', 'GET', '/api/me'); assert.equal(me.json.user.role, 'member');
  });
  it('disabling a person blocks them on their very next request', async () => {
    await invite(env, BOB);
    assert.equal((await env.call(BOB, 'GET', '/api/projects')).status, 200);
    assert.equal((await env.call(ADMIN, 'POST', `/api/admin/users/${BOB}/disable`)).status, 200);
    const r = await env.call(BOB, 'GET', '/api/projects'); assert.equal(r.status, 403); assert.equal(r.json.error.code, 'disabled');
    assert.equal((await env.call(ADMIN, 'POST', `/api/admin/users/${BOB}/enable`)).status, 200);
    assert.equal((await env.call(BOB, 'GET', '/api/projects')).status, 200);
  });
  it('forged cross-site requests are refused (CSRF): missing or foreign Origin', async () => {
    const before = await counts(env);
    for (const origin of [null, 'https://evil.example', 'http://portal.test']) {
      const r = await env.call(ADMIN, 'POST', '/api/projects', { code: 'EVIL-1', title: 'x', clientName: 'x' }, { origin });
      assert.equal(r.status, 403, String(origin)); assert.equal(r.json.error.code, 'bad_origin');
    }
    assert.deepEqual(await counts(env), before);
    assert.equal((await env.call(ADMIN, 'GET', '/api/projects', undefined, { origin: null })).status, 200); // reads are fine
  });
  it('every response is private and uncacheable', async () => {
    const r = await env.call(ADMIN, 'GET', '/api/projects');
    assert.match(r.headers.get('cache-control'), /no-store/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const e = await env.call(null, 'GET', '/api/projects'); assert.match(e.headers.get('cache-control'), /no-store/);
  });
});

describe('members are strictly read-only', () => {
  let env, P; before(async () => {
    env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me');
    P = await mkProject(env, { stage: 'work_in_progress' });
    await invite(env, MARIA, [P.id]);
    await env.call(MARIA, 'GET', '/api/me');
  }); after(() => env.close());

  it('Maria can read her project', async () => { assert.equal((await env.call(MARIA, 'GET', `/api/projects/${P.id}`)).status, 200); });

  it('every write endpoint refuses a member and changes nothing', async () => {
    const snap = await counts(env);
    const auditBefore = (await env.q('SELECT count(*)::int n FROM audit_log'))[0].n;
    const attempts = [
      ['POST', '/api/projects', { code: 'HACK-1', title: 't', clientName: 'c' }],
      ['PATCH', `/api/projects/${P.id}`, { title: 'hacked', trackerVisible: true, stage: 'completed' }],
      ['DELETE', `/api/projects/${P.id}`, { confirmCode: P.code }],
      ['POST', `/api/projects/${P.id}/members`, { email: LENDER }],
      ['DELETE', `/api/projects/${P.id}/members/${MARIA}`, {}],
      ['POST', `/api/projects/${P.id}/documents`, { title: 'x', kind: 'receipt', fileName: 'a.pdf', dataBase64: b64(pdf()) }],
      ['DELETE', `/api/documents/${UUID0}`, {}],
      ['POST', '/api/admin/invite', { email: 'friend@x.test' }],
      ['POST', `/api/admin/users/${BOB}/disable`, {}], ['POST', `/api/admin/users/${BOB}/enable`, {}], ['POST', `/api/admin/users/${BOB}/resend`, {}],
      ['DELETE', `/api/admin/users/${BOB}`, {}],
      ['POST', '/api/admin/import/preview', { dataBase64: 'UEs=' }], ['POST', '/api/admin/import/commit', { dataBase64: 'UEs=' }],
      ['PATCH', '/api/admin/requests/FCV-Q-0001', { fields: { 'Quote Status': 'Accepted' } }], ['POST', '/api/admin/requests/FCV-Q-0001/project', {}]
    ];
    for (const key of ['budget-lines', 'expenses', 'supplements', 'draws', 'remaining-items']) {
      attempts.push(['POST', `/api/projects/${P.id}/${key}`, { category: 'x', amountCents: 100 }]);
      attempts.push(['PATCH', `/api/projects/${P.id}/${key}/${UUID0}`, { notes: 'x' }]);
      attempts.push(['DELETE', `/api/projects/${P.id}/${key}/${UUID0}`, {}]);
    }
    for (const [m, p, b] of attempts) {
      const r = await env.call(MARIA, m, p, b);
      assert.equal(r.status, 403, `${m} ${p} -> ${r.status}`); assert.equal(r.json.error.code, 'admin_only', `${m} ${p}`);
    }
    for (const p of ['/api/admin/users', '/api/admin/audit', '/api/admin/health', '/api/admin/requests']) {
      const r = await env.call(MARIA, 'GET', p); assert.equal(r.status, 403, p);
    }
    assert.deepEqual(await counts(env), snap);
    assert.equal((await env.q('SELECT count(*)::int n FROM audit_log'))[0].n, auditBefore, 'refused attempts must not alter data or history');
    assert.equal((await env.q('SELECT title FROM projects WHERE id = $1', [P.id]))[0].title, 'Garage studio');
  });
});

describe('members only see projects assigned to them', () => {
  let env, P1, P2; before(async () => {
    env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me');
    P1 = await mkProject(env, { stage: 'work_in_progress', title: 'Maria job' }); P2 = await mkProject(env, { stage: 'work_in_progress', title: 'Bob job' });
    await invite(env, MARIA, [P1.id]); await invite(env, BOB, [P2.id]); await invite(env, LENDER);
    for (const e of [MARIA, BOB, LENDER]) await env.call(e, 'GET', '/api/me');
  }); after(() => env.close());

  it('lists contain only assigned projects', async () => {
    assert.deepEqual((await env.call(MARIA, 'GET', '/api/projects')).json.projects.map((p) => p.id), [P1.id]);
    assert.deepEqual((await env.call(BOB, 'GET', '/api/projects')).json.projects.map((p) => p.id), [P2.id]);
    assert.deepEqual((await env.call(LENDER, 'GET', '/api/projects')).json.projects, []);
    assert.equal((await env.call(ADMIN, 'GET', '/api/projects')).json.projects.length, 2);
  });
  it("someone else's project looks exactly like a project that does not exist", async () => {
    const other = await env.call(MARIA, 'GET', `/api/projects/${P2.id}`);
    const nothing = await env.call(MARIA, 'GET', `/api/projects/${UUID0}`);
    assert.equal(other.status, 404); assert.equal(nothing.status, 404);
    assert.deepEqual(other.json, nothing.json);
    assert.equal((await env.call(LENDER, 'GET', `/api/projects/${P1.id}`)).status, 404);
  });
  it("a document on someone else's project cannot be downloaded", async () => {
    const up = await env.call(ADMIN, 'POST', `/api/projects/${P2.id}/documents`, { title: 'Receipt', kind: 'receipt', fileName: 'r.pdf', dataBase64: b64(pdf('bob-secret')) });
    assert.equal(up.status, 201); const id = up.json.document.id;
    assert.equal((await env.call(MARIA, 'GET', `/api/documents/${id}/download`)).status, 404);
    assert.equal((await env.call(LENDER, 'GET', `/api/documents/${id}/download`)).status, 404);
    const ok = await env.call(BOB, 'GET', `/api/documents/${id}/download`); assert.equal(ok.status, 200);
    assert.match(Buffer.from(await ok.res.arrayBuffer()).toString(), /bob-secret/);
  });
  it('removing access takes effect immediately; re-adding restores it', async () => {
    assert.equal((await env.call(ADMIN, 'DELETE', `/api/projects/${P1.id}/members/${MARIA}`, {})).status, 200);
    assert.equal((await env.call(MARIA, 'GET', `/api/projects/${P1.id}`)).status, 404);
    assert.equal((await env.call(ADMIN, 'POST', `/api/projects/${P1.id}/members`, { email: MARIA })).status, 200);
    assert.equal((await env.call(MARIA, 'GET', `/api/projects/${P1.id}`)).status, 200);
  });
  it('access can only be granted to someone who was invited, and never to an admin', async () => {
    assert.equal((await env.call(ADMIN, 'POST', `/api/projects/${P1.id}/members`, { email: 'nobody@x.test' })).json.error.code, 'user_not_invited');
    assert.equal((await env.call(ADMIN, 'POST', `/api/projects/${P1.id}/members`, { email: ADMIN })).json.error.code, 'is_admin');
    assert.equal((await env.call(ADMIN, 'POST', `/api/projects/${P1.id}/members`, { email: 'not-an-email' })).status, 400);
  });
});

describe('the tracker only appears when it should', () => {
  let env; before(async () => { env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me'); await invite(env, MARIA); await env.call(MARIA, 'GET', '/api/me'); }); after(() => env.close());

  it('hidden before work starts, shown automatically in progress and when completed, and switchable by the admin', async () => {
    const P = await mkProject(env, { stage: 'accepted', baseEstimateCents: 3758289 });
    await env.call(ADMIN, 'POST', `/api/projects/${P.id}/members`, { email: MARIA });
    await env.call(ADMIN, 'POST', `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-01', vendor: 'Home Depot', description: 'Drywall', amountCents: 12345 });
    const view = async () => (await env.call(MARIA, 'GET', `/api/projects/${P.id}`)).json;
    let v = await view(); assert.equal(v.tracker, null);
    assert.equal((await env.call(MARIA, 'GET', '/api/projects')).json.projects[0].summary, undefined, 'no numbers in the list either');
    const up = await env.call(ADMIN, 'POST', `/api/projects/${P.id}/documents`, { title: 'R', kind: 'receipt', fileName: 'r.pdf', dataBase64: b64(pdf()) });
    assert.equal((await env.call(MARIA, 'GET', `/api/documents/${up.json.document.id}/download`)).status, 404, 'documents are part of the tracker');
    await env.call(ADMIN, 'PATCH', `/api/projects/${P.id}`, { stage: 'work_in_progress' });
    v = await view(); assert.ok(v.tracker); assert.equal(v.tracker.expenses.length, 1);
    assert.equal((await env.call(MARIA, 'GET', `/api/documents/${up.json.document.id}/download`)).status, 200);
    await env.call(ADMIN, 'PATCH', `/api/projects/${P.id}`, { stage: 'completed' }); assert.ok((await view()).tracker);
    await env.call(ADMIN, 'PATCH', `/api/projects/${P.id}`, { stage: 'accepted', trackerVisible: true }); assert.ok((await view()).tracker, 'admin early-access switch');
    await env.call(ADMIN, 'PATCH', `/api/projects/${P.id}`, { trackerVisible: false }); assert.equal((await view()).tracker, null);
  });
  it('a member never receives admin-only fields, and the quote stays hidden until it is ready', async () => {
    const P = await mkProject(env, { stage: 'new', baseEstimateCents: 5000000, requestRef: 'FCV-Q-0099', clientMessage: 'Hello' });
    await env.call(ADMIN, 'POST', `/api/projects/${P.id}/members`, { email: MARIA });
    let v = (await env.call(MARIA, 'GET', `/api/projects/${P.id}`)).json;
    assert.equal(v.project.baseEstimateCents, null); assert.equal(v.members, undefined);
    assert.ok(!('requestRef' in v.project) && !('createdBy' in v.project)); assert.equal(v.permissions.canEdit, false);
    await env.call(ADMIN, 'PATCH', `/api/projects/${P.id}`, { stage: 'quote_sent' });
    v = (await env.call(MARIA, 'GET', `/api/projects/${P.id}`)).json; assert.equal(v.project.baseEstimateCents, 5000000);
    const a = (await env.call(ADMIN, 'GET', `/api/projects/${P.id}`)).json; assert.equal(a.project.requestRef, 'FCV-Q-0099'); assert.equal(a.permissions.canEdit, true);
  });
});

describe('invitations and people', () => {
  let env; before(async () => { env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me'); }); after(() => env.close());

  it('inviting saves the person, assigns projects, and asks Netlify Identity to send the email with the operator token', async () => {
    const P = await mkProject(env);
    const r = await env.call(ADMIN, 'POST', '/api/admin/invite', { email: '  Maria@Client.TEST ', name: 'Maria', projectIds: [P.id] });
    assert.equal(r.status, 201); assert.equal(r.json.emailSent, true); assert.equal(r.json.email, MARIA);
    assert.deepEqual(env.state.invites, [MARIA]);
    assert.equal((await env.q('SELECT count(*)::int n FROM project_members WHERE email = $1 AND project_id = $2', [MARIA, P.id]))[0].n, 1);
    assert.equal((await env.q("SELECT count(*)::int n FROM audit_log WHERE action = 'user.invite'"))[0].n, 1);
  });
  it('duplicates, bad addresses and the admin address are rejected', async () => {
    assert.equal((await env.call(ADMIN, 'POST', '/api/admin/invite', { email: MARIA })).json.error.code, 'already_invited');
    assert.equal((await env.call(ADMIN, 'POST', '/api/admin/invite', { email: 'nope' })).status, 400);
    assert.equal((await env.call(ADMIN, 'POST', '/api/admin/invite', { email: ADMIN })).json.error.code, 'is_admin');
  });
  it('if Netlify cannot send the email, the person is still saved and the admin is told what to do', async () => {
    env.state.inviteResult = { ok: false, status: 500, msg: 'mailer down' };
    const r = await env.call(ADMIN, 'POST', '/api/admin/invite', { email: LENDER });
    assert.equal(r.status, 201); assert.equal(r.json.emailSent, false); assert.match(r.json.warning, /Invite lender@bank\.test from Netlify/);
    assert.equal((await env.q('SELECT status FROM portal_users WHERE email = $1', [LENDER]))[0].status, 'invited');
    env.state.inviteResult = { ok: true };
  });
  it('resend replaces an unaccepted invite and refuses once accepted', async () => {
    env.state.identityUsers = [{ id: 'u1', email: LENDER, confirmedAt: undefined }];
    const r = await env.call(ADMIN, 'POST', `/api/admin/users/${LENDER}/resend`);
    assert.equal(r.status, 200); assert.deepEqual(env.state.deleted, ['u1']); assert.equal(env.state.invites.at(-1), LENDER);
    env.state.identityUsers = [{ id: 'u2', email: MARIA, confirmedAt: '2026-10-01T00:00:00Z' }];
    assert.equal((await env.call(ADMIN, 'POST', `/api/admin/users/${MARIA}/resend`)).json.error.code, 'already_accepted');
  });
  it('the people list shows who has accepted', async () => {
    env.state.identityUsers = [{ id: 'u2', email: MARIA, confirmedAt: '2026-10-01T00:00:00Z' }];
    const r = await env.call(ADMIN, 'GET', '/api/admin/users');
    assert.equal(r.json.users.find((u) => u.email === MARIA).accepted, true);
    assert.equal(r.json.users.find((u) => u.email === ADMIN).designatedAdmin, true);
  });
  it('removing someone deletes their access and their login; admins and yourself are protected', async () => {
    const P = await mkProject(env); await env.call(ADMIN, 'POST', `/api/projects/${P.id}/members`, { email: MARIA });
    env.state.identityUsers = [{ id: 'u2', email: MARIA, confirmedAt: 'x' }];
    const r = await env.call(ADMIN, 'DELETE', `/api/admin/users/${MARIA}`, {});
    assert.equal(r.status, 200); assert.equal(r.json.loginRemoved, true);
    assert.equal((await env.q('SELECT count(*)::int n FROM project_members WHERE email = $1', [MARIA]))[0].n, 0);
    assert.equal((await env.call(MARIA, 'GET', '/api/projects')).status, 403);
    assert.equal((await env.call(ADMIN, 'DELETE', `/api/admin/users/${ADMIN}`, {})).json.error.code, 'self');
    assert.equal((await env.call(ADMIN, 'POST', `/api/admin/users/${ADMIN}/disable`)).status, 400);
  });
});

describe('hostile and malformed input', () => {
  let env, P; before(async () => { env = await makeEnv(); await env.call(ADMIN, 'GET', '/api/me'); P = await mkProject(env); }); after(() => env.close());

  it('bad content types, bodies and ids are rejected cleanly', async () => {
    assert.equal((await env.call(ADMIN, 'POST', '/api/projects', 'code=x', { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await env.call(ADMIN, 'POST', '/api/projects', '[1,2]')).status, 400);
    assert.equal((await env.call(ADMIN, 'POST', '/api/projects', '{oops')).status, 400);
    assert.equal((await env.call(ADMIN, 'POST', '/api/projects', JSON.stringify({ code: 'BIG-1', title: 'x'.repeat(100000), clientName: 'c' }))).status, 413);
    assert.equal((await env.call(ADMIN, 'GET', '/api/projects/not-a-uuid')).status, 404);
    assert.equal((await env.call(ADMIN, 'GET', '/api/nope')).status, 404);
    assert.equal((await env.call(ADMIN, 'PUT', '/api/projects')).status, 405);
  });
  it('SQL-injection and script text is stored as plain text and never executed', async () => {
    const evil = "'); DROP TABLE projects; --";
    const r = await env.call(ADMIN, 'POST', `/api/projects/${P.id}/expenses`, { purchasedOn: '2026-10-01', vendor: evil, description: '<script>alert(1)</script>', amountCents: 100 });
    assert.equal(r.status, 201); assert.equal(r.json.record.vendor, evil); assert.equal(r.json.record.description, '<script>alert(1)</script>');
    assert.equal((await env.q('SELECT count(*)::int n FROM projects'))[0].n, 1);
    const a = await env.call(ADMIN, 'GET', `/api/admin/audit?action=${encodeURIComponent("x' OR '1'='1")}&before=1;DROP`);
    assert.equal(a.status, 200);
  });
  it('unknown fields are ignored, never written', async () => {
    const r = await env.call(ADMIN, 'PATCH', `/api/projects/${P.id}`, { title: 'Renamed', createdBy: 'attacker', id: UUID0, created_at: '1999-01-01', 'title; DROP': 'x' });
    assert.equal(r.status, 200);
    const row = (await env.q('SELECT title, created_by, id FROM projects WHERE id = $1', [P.id]))[0];
    assert.equal(row.title, 'Renamed'); assert.equal(row.created_by, ADMIN); assert.equal(row.id, P.id);
  });
  it('the admin health check reports an open sign-up as a problem', async () => {
    let h = await env.call(ADMIN, 'GET', '/api/admin/health');
    assert.ok(h.json.checks.find((c) => c.name === 'Registration is invite-only').ok);
    env.state.disableSignup = false;
    h = await env.call(ADMIN, 'GET', '/api/admin/health');
    const c = h.json.checks.find((x) => x.name === 'Registration is invite-only'); assert.equal(c.ok, false); assert.match(c.detail, /PUBLIC SIGN-UP IS ON/);
    assert.ok(h.json.checks.find((x) => x.name === 'Private file storage').ok);
  });
});
