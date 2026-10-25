import { HttpError } from './http.mjs';
import { cleanFields, failIfErrors } from './fields.mjs';
import { writeAudit, diff } from './audit.mjs';
import { ENTITIES, listEntity } from './entities.mjs';
import { computeSummary } from './calc.mjs';

export const STAGES = ['new', 'contacted', 'site_visit', 'quote_sent', 'accepted', 'work_in_progress', 'completed', 'declined'];
// The project tracker (the six tabs) is shown to members when the admin has switched it on,
// or automatically once the job is in progress or completed.
export const TRACKER_STAGES = ['work_in_progress', 'completed'];
const QUOTE_VISIBLE_STAGES = ['quote_sent', 'accepted', 'work_in_progress', 'completed'];

export const PROJECT_FIELDS = {
  code: { kind: 'text', max: 40, required: true },
  title: { kind: 'text', max: 200, required: true },
  clientName: { kind: 'text', max: 200, required: true },
  address: { kind: 'text', max: 300 },
  contractor: { kind: 'text', max: 200, default: 'FCV Restoration & Construction' },
  phaseLabel: { kind: 'text', max: 200 },
  lenderStatus: { kind: 'text', max: 200, default: 'Preliminary / not lender-approved' },
  estimateSource: { kind: 'text', max: 200 },
  stage: { kind: 'enum', values: STAGES, default: 'new' },
  trackerVisible: { kind: 'bool' },
  baseEstimateCents: { kind: 'cents' },
  workStartDate: { kind: 'date' },
  clientMessage: { kind: 'text', max: 1000, multiline: true },
  notes: { kind: 'textlist', max: 500, maxItems: 20 },
  requestRef: { kind: 'text', max: 40, nullable: true }
};

const PROJECT_SELECT = `id, code, title, client_name, address, contractor, phase_label, lender_status, estimate_source, stage,
  tracker_visible, base_estimate_cents, work_start_date::text AS work_start_date, client_message, notes, request_ref, request_snapshot,
  created_by, created_at::text AS created_at, updated_at::text AS updated_at`;

export function projectToApi(r) {
  return {
    id: r.id, code: r.code, title: r.title, clientName: r.client_name, address: r.address, contractor: r.contractor,
    phaseLabel: r.phase_label, lenderStatus: r.lender_status, estimateSource: r.estimate_source, stage: r.stage,
    trackerVisible: !!r.tracker_visible, baseEstimateCents: r.base_estimate_cents == null ? null : Number(r.base_estimate_cents),
    workStartDate: r.work_start_date, clientMessage: r.client_message, notes: Array.isArray(r.notes) ? r.notes : [],
    requestRef: r.request_ref, requestSnapshot: r.request_snapshot || null, createdBy: r.created_by,
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

export const trackerVisibleFor = (p) => p.trackerVisible || TRACKER_STAGES.includes(p.stage);

export async function getProjectRow(q, id) {
  const [r] = await q.query(`SELECT ${PROJECT_SELECT} FROM projects WHERE id = $1`, [id]);
  if (!r) throw new HttpError(404, 'not_found', 'That project was not found.');
  return projectToApi(r);
}

export async function loadTracker(q, project) {
  const [lines, expenses, supplements, draws, remaining] = await Promise.all([
    listEntity(q, ENTITIES['budget-lines'], project.id), listEntity(q, ENTITIES.expenses, project.id),
    listEntity(q, ENTITIES.supplements, project.id), listEntity(q, ENTITIES.draws, project.id),
    listEntity(q, ENTITIES['remaining-items'], project.id)
  ]);
  const docs = await q.query(
    `SELECT id, kind, title, file_name, content_type, size_bytes, linked_type, linked_id, uploaded_at::text AS uploaded_at
     FROM documents WHERE project_id = $1 ORDER BY uploaded_at`, [project.id]);
  const documents = docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, fileName: d.file_name, contentType: d.content_type,
    sizeBytes: Number(d.size_bytes), linkedType: d.linked_type, linkedId: d.linked_id, uploadedAt: d.uploaded_at }));
  const summary = computeSummary({ project, lines, expenses, supplements, draws, remaining });
  return { budgetLines: lines, expenses, supplements, draws, remaining, documents, summary };
}

// What a member may see about a project: never internal fields.
function memberView(p) {
  const showQuote = p.trackerVisible || QUOTE_VISIBLE_STAGES.includes(p.stage);
  return { ...p, baseEstimateCents: showQuote ? p.baseEstimateCents : null, requestRef: undefined, createdBy: undefined };
}

export async function listProjects(db, user) {
  const rows = user.role === 'admin'
    ? await db.query(`SELECT ${PROJECT_SELECT} FROM projects ORDER BY updated_at DESC LIMIT 500`)
    : await db.query(`SELECT ${PROJECT_SELECT} FROM projects
                      WHERE id IN (SELECT project_id FROM project_members WHERE email = $1) ORDER BY updated_at DESC LIMIT 500`, [user.email]);
  const out = [];
  for (const r of rows) {
    const p = projectToApi(r);
    const visible = user.role === 'admin' || trackerVisibleFor(p);
    const card = user.role === 'admin' ? p : memberView(p);
    if (visible) { const t = await loadTracker(db, p); card.summary = t.summary; }
    out.push(card);
  }
  return out;
}

export async function getBundle(db, user, id) {
  const p = await getProjectRow(db, id);
  if (user.role !== 'admin') {
    const [m] = await db.query('SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND email = $2', [id, user.email]);
    // Not assigned: behave exactly like a project that does not exist.
    if (!m) throw new HttpError(404, 'not_found', 'That project was not found.');
  }
  const isAdmin = user.role === 'admin';
  const visible = isAdmin || trackerVisibleFor(p);
  const bundle = { project: isAdmin ? p : memberView(p), tracker: visible ? await loadTracker(db, p) : null, permissions: { canEdit: isAdmin } };
  if (isAdmin) {
    bundle.members = (await db.query(
      `SELECT m.email, u.display_name, u.status, m.added_at::text AS added_at FROM project_members m
       LEFT JOIN portal_users u ON u.email = m.email WHERE m.project_id = $1 ORDER BY m.email`, [id]))
      .map((r) => ({ email: r.email, name: r.display_name || '', status: r.status || 'unknown', addedAt: r.added_at }));
  }
  return bundle;
}

function projectRules(c, errors) {
  if (c.code !== undefined) {
    c.code = String(c.code).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{2,39}$/.test(c.code)) errors.code = 'Use 3–40 letters, numbers, dots or dashes (for example FCV-MT-ADU-01).';
  }
}

const colOf = (n) => n.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

export async function createProject(q, actor, body) {
  const { clean, errors } = cleanFields(body, PROJECT_FIELDS);
  projectRules(clean, errors);
  failIfErrors(errors);
  const snapshot = body.requestSnapshot && typeof body.requestSnapshot === 'object' ? body.requestSnapshot : null;
  const names = Object.keys(clean).filter((k) => k !== 'notes');
  const params = names.map((n) => clean[n]);
  const sql = `INSERT INTO projects (${names.map(colOf).join(', ')}, notes, request_snapshot, created_by)
               VALUES (${names.map((_, i) => '$' + (i + 1)).join(', ')}, $${names.length + 1}::jsonb, $${names.length + 2}::jsonb, $${names.length + 3}) RETURNING id`;
  const [r] = await q.query(sql, [...params, JSON.stringify(clean.notes || []), snapshot ? JSON.stringify(snapshot) : null, actor.email]);
  const p = await getProjectRow(q, r.id);
  await writeAudit(q, actor, { action: 'project.create', entityType: 'project', entityId: p.id, projectId: p.id, summary: `Created project ${p.code}`, after: { ...p, requestSnapshot: undefined } });
  return p;
}

export async function updateProject(q, actor, id, body) {
  const existing = await getProjectRow(q, id);
  const merged = {};
  for (const k of Object.keys(PROJECT_FIELDS)) merged[k] = Object.prototype.hasOwnProperty.call(body, k) ? body[k] : existing[k];
  const { clean, errors } = cleanFields(merged, PROJECT_FIELDS);
  projectRules(clean, errors);
  failIfErrors(errors);
  const base = {}; for (const k of Object.keys(PROJECT_FIELDS)) base[k] = existing[k];
  const { before, after, changed } = diff(base, clean);
  if (!changed) return { project: existing, changed: false, stageChanged: false };
  const names = Object.keys(after);
  const sets = names.map((n, i) => (n === 'notes' ? `notes = $${i + 2}::jsonb` : `${colOf(n)} = $${i + 2}`));
  await q.query(`UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
    [id, ...names.map((n) => (n === 'notes' ? JSON.stringify(after[n]) : after[n]))]);
  const p = await getProjectRow(q, id);
  await writeAudit(q, actor, { action: 'project.update', entityType: 'project', entityId: id, projectId: id, summary: `Edited project ${p.code} (${names.join(', ')})`, before, after });
  return { project: p, changed: true, stageChanged: 'stage' in after, previousStage: existing.stage };
}

export async function deleteProject(q, actor, id, confirmCode) {
  const p = await getProjectRow(q, id);
  if (String(confirmCode || '').toUpperCase() !== p.code) {
    throw new HttpError(400, 'confirm_required', `Type the project code (${p.code}) to confirm deleting it.`);
  }
  const docs = await q.query('SELECT blob_key FROM documents WHERE project_id = $1', [id]);
  const counts = {};
  for (const [k, t] of [['budgetLines', 'budget_lines'], ['expenses', 'expenses'], ['supplements', 'supplements'], ['draws', 'draws'], ['remainingItems', 'remaining_items'], ['documents', 'documents'], ['members', 'project_members']]) {
    const [r] = await q.query(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [id]); counts[k] = Number(r.n);
  }
  const tracker = await loadTracker(q, p);
  await q.query('DELETE FROM projects WHERE id = $1', [id]);
  await writeAudit(q, actor, { action: 'project.delete', entityType: 'project', entityId: id, projectId: id, summary: `Deleted project ${p.code}`,
    before: { project: { ...p, requestSnapshot: undefined }, counts, tracker: { budgetLines: tracker.budgetLines, expenses: tracker.expenses, supplements: tracker.supplements, draws: tracker.draws, remaining: tracker.remaining, documents: tracker.documents } } });
  return { blobKeys: docs.map((d) => d.blob_key), code: p.code };
}

export async function addMember(q, actor, projectId, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new HttpError(400, 'validation', 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  const p = await getProjectRow(q, projectId);
  const [u] = await q.query('SELECT role, status FROM portal_users WHERE email = $1', [e]);
  if (!u) throw new HttpError(404, 'user_not_invited', 'Invite this person first, then give them access to the project.');
  if (u.role === 'admin') throw new HttpError(400, 'is_admin', 'Administrators can already see every project.');
  const r = await q.query('INSERT INTO project_members (project_id, email, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING email', [projectId, e, actor.email]);
  if (r.length) await writeAudit(q, actor, { action: 'project.member_add', entityType: 'project', entityId: projectId, projectId, summary: `Gave ${e} read-only access to ${p.code}`, after: { email: e } });
  return { added: r.length > 0 };
}

export async function removeMember(q, actor, projectId, email) {
  const e = String(email || '').trim().toLowerCase();
  const p = await getProjectRow(q, projectId);
  const r = await q.query('DELETE FROM project_members WHERE project_id = $1 AND email = $2 RETURNING email', [projectId, e]);
  if (r.length) await writeAudit(q, actor, { action: 'project.member_remove', entityType: 'project', entityId: projectId, projectId, summary: `Removed ${e}'s access to ${p.code}`, before: { email: e } });
  return { removed: r.length > 0 };
}
