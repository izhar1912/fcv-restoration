// FCV Client & Lender Portal: the one server-side API.
// Every request passes the same gate, in this order:
//   1. CSRF check on anything that changes data  2. a valid Netlify Identity session
//   3. an invite on file that is not disabled     4. the route's own rule (admin only, or assigned to the project)
import { createRouter, errorResponse, json, mustUuid, readJson, HttpError } from '../lib/http.mjs';
import { db as getDb } from '../lib/db.mjs';
import { docStore } from '../lib/blobs.mjs';
import { guardMutation, requireAdmin, requireUser, adminAllowlist } from '../lib/auth.mjs';
import { ENTITIES, createEntity, updateEntity, deleteEntity } from '../lib/entities.mjs';
import {
  STAGES, addMember, createProject, deleteProject, getBundle, getProjectRow, listProjects, removeMember, updateProject
} from '../lib/projects.mjs';
import { deleteDocument, downloadDocument, uploadDocument } from '../lib/documents.mjs';
import { inviteUser, listUsers, removeUser, resendInvite, setUserStatus } from '../lib/users.mjs';
import { REQUEST_EDITABLE, STAGE_TO_STATUS, STATUS_TO_STAGE, sheetList, sheetUpdate } from '../lib/sheet.mjs';
import { commitImport, parseWorkbook } from '../lib/xlsx-import.mjs';
import { writeAudit } from '../lib/audit.mjs';
import { getIdentityConfig, getSettings } from '../lib/identity.mjs';

export const config = {
  path: '/api/*',
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};

const router = createRouter();
const BIG = 6 * 1024 * 1024;

/* ------------------------------ everyone signed in ------------------------------ */
router.add('GET', '/api/me', async ({ user }) => json({ user: { email: user.email, name: user.name, role: user.role }, stages: STAGES }));

router.add('GET', '/api/projects', async ({ db, user }) => json({ projects: await listProjects(db, user) }));

router.add('GET', '/api/projects/:id', async ({ db, user, params }) => json(await getBundle(db, user, mustUuid(params.id, 'project'))));

router.add('GET', '/api/documents/:id/download', async ({ db, user, params, context }) =>
  downloadDocument(db, docStore(context), user, mustUuid(params.id, 'document')));

/* ----------------------------------- admin: projects ----------------------------------- */
async function syncStage(db, user, result) {
  // Keep the Google Sheet pipeline in step. Best effort: a sheet problem must never block the portal.
  const p = result.project;
  if (!result.stageChanged || !p.requestRef) return undefined;
  try { await sheetUpdate('quote', p.requestRef, 0, { 'Quote Status': STAGE_TO_STATUS[p.stage] }); return 'synced'; }
  catch (e) {
    await db.tx((q) => writeAudit(q, user, { action: 'sheet.sync_failed', entityType: 'project', entityId: p.id, projectId: p.id, summary: `Could not update the sheet status for ${p.requestRef}: ${e.message}` }));
    return 'failed';
  }
}

router.add('POST', '/api/projects', async ({ req, db, user }) => {
  requireAdmin(user);
  const body = await readJson(req);
  const project = await db.tx((q) => createProject(q, user, body));
  return json({ project }, 201);
});

router.add('PATCH', '/api/projects/:id', async ({ req, db, user, params }) => {
  requireAdmin(user);
  const body = await readJson(req);
  const result = await db.tx((q) => updateProject(q, user, mustUuid(params.id, 'project'), body));
  const sheetSync = await syncStage(db, user, result);
  return json({ project: result.project, changed: result.changed, sheetSync });
});

router.add('DELETE', '/api/projects/:id', async ({ req, db, user, params, context }) => {
  requireAdmin(user);
  const body = await readJson(req);
  const out = await db.tx((q) => deleteProject(q, user, mustUuid(params.id, 'project'), body.confirmCode));
  const store = docStore(context);
  for (const k of out.blobKeys) { try { await store.delete(k); } catch { /* private orphan; harmless */ } }
  return json({ deleted: true, code: out.code });
});

router.add('POST', '/api/projects/:id/members', async ({ req, db, user, params }) => {
  requireAdmin(user);
  const body = await readJson(req);
  return json(await db.tx((q) => addMember(q, user, mustUuid(params.id, 'project'), body.email)));
});
router.add('DELETE', '/api/projects/:id/members/:email', async ({ db, user, params }) => {
  requireAdmin(user);
  return json(await db.tx((q) => removeMember(q, user, mustUuid(params.id, 'project'), params.email)));
});

/* ------------------------- admin: the five tracker tables ------------------------- */
for (const key of Object.keys(ENTITIES)) {
  router.add('POST', `/api/projects/:id/${key}`, async ({ req, db, user, params }) => {
    requireAdmin(user);
    const body = await readJson(req);
    const row = await db.tx(async (q) => createEntity(q, user, await getProjectRow(q, mustUuid(params.id, 'project')), key, body));
    return json({ record: row }, 201);
  });
  router.add('PATCH', `/api/projects/:id/${key}/:rid`, async ({ req, db, user, params }) => {
    requireAdmin(user);
    const body = await readJson(req);
    const row = await db.tx(async (q) => updateEntity(q, user, await getProjectRow(q, mustUuid(params.id, 'project')), key, mustUuid(params.rid, 'record'), body));
    return json({ record: row });
  });
  router.add('DELETE', `/api/projects/:id/${key}/:rid`, async ({ db, user, params }) => {
    requireAdmin(user);
    return json(await db.tx(async (q) => deleteEntity(q, user, await getProjectRow(q, mustUuid(params.id, 'project')), key, mustUuid(params.rid, 'record'))));
  });
}

/* ---------------------------------- admin: documents ---------------------------------- */
router.add('POST', '/api/projects/:id/documents', async ({ req, db, user, params, context }) => {
  requireAdmin(user);
  const body = await readJson(req, BIG);
  return json({ document: await uploadDocument(db, docStore(context), user, mustUuid(params.id, 'project'), body) }, 201);
});
router.add('DELETE', '/api/documents/:id', async ({ db, user, params, context }) => {
  requireAdmin(user);
  return json(await deleteDocument(db, docStore(context), user, mustUuid(params.id, 'document')));
});

/* --------------------------- admin: people and invitations --------------------------- */
router.add('GET', '/api/admin/users', async ({ db, user }) => { requireAdmin(user); return json(await listUsers(db)); });
router.add('POST', '/api/admin/invite', async ({ req, db, user }) => { requireAdmin(user); return json(await inviteUser(db, user, await readJson(req)), 201); });
router.add('POST', '/api/admin/users/:email/resend', async ({ db, user, params }) => { requireAdmin(user); return json(await resendInvite(db, user, params.email)); });
router.add('POST', '/api/admin/users/:email/disable', async ({ db, user, params }) => { requireAdmin(user); return json(await setUserStatus(db, user, params.email, 'disabled')); });
router.add('POST', '/api/admin/users/:email/enable', async ({ db, user, params }) => { requireAdmin(user); return json(await setUserStatus(db, user, params.email, 'active')); });
router.add('DELETE', '/api/admin/users/:email', async ({ db, user, params }) => { requireAdmin(user); return json(await removeUser(db, user, params.email)); });

/* ------------------------------------ admin: audit ------------------------------------ */
router.add('GET', '/api/admin/audit', async ({ db, user, url }) => {
  requireAdmin(user);
  const sp = url.searchParams;
  const project = sp.get('project') ? mustUuid(sp.get('project'), 'project') : null;
  const before = /^\d+$/.test(sp.get('before') || '') ? sp.get('before') : null;
  const action = (sp.get('action') || '').replace(/[^a-z._]/gi, '').slice(0, 40);
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 200);
  const rows = await db.query(
    `SELECT a.id, a.at::text AS at, a.actor_email, a.actor_role, a.action, a.entity_type, a.entity_id, a.project_id, p.code AS project_code,
            a.summary, a.before, a.after, a.ip
     FROM audit_log a LEFT JOIN projects p ON p.id = a.project_id
     WHERE ($1::uuid IS NULL OR a.project_id = $1::uuid) AND ($2::bigint IS NULL OR a.id < $2::bigint) AND ($3 = '' OR a.action LIKE $3 || '%')
     ORDER BY a.id DESC LIMIT ${limit + 1}`, [project, before, action]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit).map((r) => ({ id: String(r.id), at: r.at, actor: r.actor_email, role: r.actor_role, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
    projectId: r.project_id, projectCode: r.project_code, summary: r.summary, before: r.before, after: r.after, ip: r.ip }));
  return json({ entries: page, next: more ? page[page.length - 1].id : null });
});

/* --------------------------- admin: quote requests (Google Sheet) --------------------------- */
router.add('GET', '/api/admin/requests', async ({ db, user }) => {
  requireAdmin(user);
  const data = await sheetList();
  const refs = (data.quotes || []).map((q) => q.Reference);
  const linked = refs.length ? await db.query('SELECT id, code, request_ref FROM projects WHERE request_ref = ANY($1::text[])', [refs]) : [];
  const byRef = Object.fromEntries(linked.map((p) => [p.request_ref, { id: p.id, code: p.code }]));
  return json({ quotes: (data.quotes || []).map((q) => ({ ...q, project: byRef[q.Reference] || null })), contacts: data.contacts || [], statusOptions: data.statusOptions || [] });
});

router.add('PATCH', '/api/admin/requests/:ref', async ({ req, db, user, params }) => {
  requireAdmin(user);
  const body = await readJson(req);
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  const names = Object.keys(fields);
  if (!names.length) throw new HttpError(400, 'validation', 'Nothing to save.');
  const tab = body.tab === 'contact' ? 'contact' : 'quote';
  const allowed = tab === 'contact' ? ['Name', 'Phone', 'Email', 'Subject', 'Quote Status', 'Actual Price', 'Internal Notes'] : REQUEST_EDITABLE;
  for (const n of names) if (!allowed.includes(n)) throw new HttpError(400, 'forbidden_field', `The field "${n}" cannot be edited.`);
  const r = await sheetUpdate(tab, String(params.ref).slice(0, 40), Number(body.row) || 0, fields);
  await db.tx((q) => writeAudit(q, user, { action: 'request.update', entityType: 'request', entityId: params.ref, summary: `Edited request ${params.ref} (${names.join(', ')})`, after: fields }));
  return json({ record: r.record });
});

router.add('POST', '/api/admin/requests/:ref/project', async ({ req, db, user, params }) => {
  requireAdmin(user);
  const body = await readJson(req);
  const data = await sheetList();
  const q = (data.quotes || []).find((x) => x.Reference === params.ref);
  if (!q) throw new HttpError(404, 'not_found', 'That request was not found in the sheet.');
  const items = String(q['Selected Items'] || '').split(/\s*;\s*/).filter(Boolean);
  const visit = String(q['Site-Visit Items'] || '').split(/\s*;\s*/).filter(Boolean);
  const price = Number(q['Actual Price']);
  const payload = {
    code: body.code || q.Reference, title: body.title || `Renovation for ${q.Name}`, clientName: q.Name,
    address: [q['Property Address'], q.City, q.ZIP].filter(Boolean).join(', '),
    stage: STATUS_TO_STAGE[q['Quote Status']] || 'new', baseEstimateCents: q['Actual Price'] !== '' && Number.isFinite(price) ? Math.round(price * 100) : null,
    workStartDate: q['Work Start Date'] || null, clientMessage: q['Client Message'] || '', requestRef: q.Reference, lenderStatus: body.lenderStatus || 'Preliminary / not lender-approved',
    // Selections only: never the customer's phone or email.
    requestSnapshot: { items, siteVisitItems: visit, estimateRange: q['Estimate Range (shown to customer)'] || '', propertyType: q['Property Type'] || '', finishLevel: q['Finish Level'] || '',
      timeline: q['Start Timeline'] || '', insuranceClaim: q['Insurance Claim'] || '', notes: q.Notes || '', city: q.City || '' }
  };
  for (const k of ['stage', 'trackerVisible', 'address', 'clientName']) if (body[k] !== undefined && body[k] !== '') payload[k] = body[k];
  const project = await db.tx((tx) => createProject(tx, user, payload));
  return json({ project, clientEmail: q.Email || '' }, 201);
});

/* ------------------------------ admin: workbook import ------------------------------ */
async function workbookFrom(req) {
  const body = await readJson(req, BIG);
  if (typeof body.dataBase64 !== 'string' || !body.dataBase64) throw new HttpError(400, 'validation', 'Choose the tracker workbook (.xlsx).');
  const buf = Buffer.from(body.dataBase64, 'base64');
  if (buf.length > 4 * 1024 * 1024) throw new HttpError(413, 'too_large', 'That workbook is too large (4 MB limit).');
  return { body, parsed: await parseWorkbook(buf) };
}
router.add('POST', '/api/admin/import/preview', async ({ req, user }) => { requireAdmin(user); const { parsed } = await workbookFrom(req); return json(parsed); });
router.add('POST', '/api/admin/import/commit', async ({ req, db, user }) => {
  requireAdmin(user);
  const { body, parsed } = await workbookFrom(req);
  const failed = parsed.report.checks.filter((c) => !c.ok);
  if (failed.length && !body.acceptMismatch) throw new HttpError(409, 'checks_failed', `The workbook's own totals do not match what was calculated (${failed.map((c) => c.label).join(', ')}). Review the preview.`);
  const project = await commitImport(db, user, parsed, body.overrides || {});
  return json({ project }, 201);
});

/* ------------------------------------ admin: health ------------------------------------ */
router.add('GET', '/api/admin/health', async ({ db, user, context }) => {
  requireAdmin(user);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  try { await db.query('SELECT 1'); add('Database', true, 'Connected'); } catch (e) { add('Database', false, String(e.message).slice(0, 120)); }
  try { const [t] = await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('projects','audit_log','portal_users')"); add('Database tables', Number(t.n) === 3, `${t.n} of 3 core tables present`); } catch { add('Database tables', false, 'Could not check'); }
  try { const s = await getSettings(); add('Registration is invite-only', !!s.disableSignup, s.disableSignup ? 'Public sign-up is off' : 'PUBLIC SIGN-UP IS ON. Set Identity → Registration to “Invite only”'); } catch { add('Registration is invite-only', false, 'Could not read Identity settings'); }
  const cfg = (() => { try { return getIdentityConfig(); } catch { return null; } })();
  add('Identity can send invitations', !!(cfg && cfg.url && cfg.token), cfg && cfg.token ? 'Ready' : 'Identity is not enabled for this site');
  add('Designated admin set', adminAllowlist().size > 0, `${adminAllowlist().size} address(es) in FCV_ADMIN_EMAILS`);
  try { const store = docStore(context); const k = `health/${Date.now()}`; await store.set(k, 'ok'); const v = await store.get(k); await store.delete(k); add('Private file storage', v != null, 'Write, read and delete worked'); } catch (e) { add('Private file storage', false, String(e.message).slice(0, 120)); }
  add('Quote-request sheet connected', !!(process.env.FCV_SHEET_ENDPOINT && process.env.FCV_SHEET_SERVICE_KEY), process.env.FCV_SHEET_ENDPOINT ? 'Endpoint and key are set' : 'Set FCV_SHEET_ENDPOINT and FCV_SHEET_SERVICE_KEY');
  return json({ context: (context && context.deploy && context.deploy.context) || 'unknown', checks });
});

/* ----------------------------------------- entry ----------------------------------------- */
function mapDbError(e) {
  if (e && e.code === '23505') return new HttpError(409, 'duplicate', 'That value is already in use (for example a project code or an ID).');
  if (e && e.code === '23514') return new HttpError(400, 'rule_violation', 'That combination of values is not allowed.');
  if (e && e.code === '23503') return new HttpError(400, 'bad_reference', 'That refers to something that does not exist.');
  return e;
}

export default async function handler(req, context) {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    guardMutation(req);
    const db = getDb();
    const user = await requireUser(db, (context && context.ip) || '');
    const { handler: h, params, pathMatched } = router.match(req.method, path);
    if (!h) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found', 'Not found.');
    return await h({ req, url, params, user, db, context });
  } catch (e) {
    return errorResponse(mapDbError(e));
  }
}
