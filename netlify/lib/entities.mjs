// The five tracker tables from the lender workbook, with their rules.
// One generic create / update / delete implementation keeps every table consistent and audited.
import { HttpError } from './http.mjs';
import { cleanFields, failIfErrors, col, todayUtc } from './fields.mjs';
import { writeAudit, diff } from './audit.mjs';

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

export const SUPPLEMENT_STATUSES = ['Draft', 'Submitted', 'Approved', 'Rejected', 'Withdrawn'];
export const DRAW_STATUSES = ['Proposed - not submitted', 'Submitted', 'Approved', 'Partially funded', 'Funded', 'Rejected'];

export const ENTITIES = {
  'budget-lines': {
    table: 'budget_lines', type: 'budget_line', label: 'Budget line', order: 'sort_order, created_at',
    extraSelect: ', round(quantity * unit_price_cents * (100 + waste_percent) / 100)::bigint AS extended_cents',
    fields: {
      code: { kind: 'text', max: 20 },
      category: { kind: 'text', max: 200, required: true },
      quantity: { kind: 'decimal', scale: 3, min: 0, required: true },
      unit: { kind: 'text', max: 40 },
      unitPriceCents: { kind: 'cents', required: true },
      wastePercent: { kind: 'decimal', scale: 2, min: 0, max: 100, default: '0.00' },
      basis: { kind: 'text', max: 300 },
      sortOrder: { kind: 'int', min: 0, max: 100000 }
    }
  },
  expenses: {
    table: 'expenses', type: 'expense', label: 'Expense', order: 'purchased_on, created_at', refField: 'expenseRef', refPrefix: 'EXP',
    fields: {
      expenseRef: { kind: 'text', max: 30 },
      purchasedOn: { kind: 'date', required: true },
      vendor: { kind: 'text', max: 200, required: true },
      budgetCategory: { kind: 'text', max: 200 },
      description: { kind: 'text', max: 500, required: true },
      receiptRef: { kind: 'text', max: 500 },
      amountCents: { kind: 'cents', min: 1, required: true },
      notes: { kind: 'text', max: 1000, multiline: true }
    },
    rules(c, errors) {
      if (c.purchasedOn && c.purchasedOn > tomorrow()) errors.purchasedOn = 'A purchase date cannot be in the future.';
    }
  },
  supplements: {
    table: 'supplements', type: 'supplement', label: 'Supplement / change order', order: 'created_at', refField: 'supplementRef', refPrefix: 'SUP',
    fields: {
      supplementRef: { kind: 'text', max: 30 },
      requestedOn: { kind: 'date' },
      scope: { kind: 'text', max: 500, required: true },
      vendorTrade: { kind: 'text', max: 200 },
      supportRef: { kind: 'text', max: 500 },
      amountCents: { kind: 'cents', required: true },
      status: { kind: 'enum', values: SUPPLEMENT_STATUSES, required: true },
      approvedOn: { kind: 'date' },
      approvalEvidence: { kind: 'text', max: 1000, multiline: true },
      notes: { kind: 'text', max: 1000, multiline: true }
    },
    rules(c, errors) {
      if (c.status && c.status !== 'Draft' && !c.requestedOn) errors.requestedOn = 'Add the date this was submitted.';
      if (c.status === 'Approved') {
        if (!c.approvalEvidence) errors.approvalEvidence = 'Record the proof of approval (who approved it, and where the signed approval is kept) before marking this Approved.';
        if (!c.approvedOn) c.approvedOn = todayUtc();
      } else {
        c.approvedOn = null; // only an Approved supplement carries an approval date
      }
    }
  },
  draws: {
    table: 'draws', type: 'draw', label: 'Draw request', order: 'created_at', refField: 'drawRef', refPrefix: 'DRAW',
    fields: {
      drawRef: { kind: 'text', max: 30 },
      requestedOn: { kind: 'date' },
      purpose: { kind: 'text', max: 500, required: true },
      amountRequestedCents: { kind: 'cents', required: true },
      amountApprovedCents: { kind: 'cents' },
      amountDisbursedCents: { kind: 'cents' },
      status: { kind: 'enum', values: DRAW_STATUSES, required: true },
      notes: { kind: 'text', max: 1000, multiline: true }
    },
    rules(c, errors) {
      const s = c.status; const a = c.amountApprovedCents; const d = c.amountDisbursedCents;
      if (!s) return;
      if (s !== 'Proposed - not submitted' && !c.requestedOn) errors.requestedOn = 'Add the date this request was submitted.';
      if (['Proposed - not submitted', 'Submitted', 'Rejected'].includes(s)) {
        if (a != null) errors.amountApprovedCents = 'Leave this empty until the lender approves an amount.';
        if (d != null) errors.amountDisbursedCents = 'Leave this empty until funds are actually paid out.';
      } else if (s === 'Approved') {
        if (a == null) errors.amountApprovedCents = 'Enter the approved amount.';
        if (d != null) errors.amountDisbursedCents = 'Nothing has been paid out yet. Use Partially funded or Funded once money is disbursed.';
      } else {
        if (a == null) errors.amountApprovedCents = 'Enter the approved amount.';
        if (d == null) errors.amountDisbursedCents = 'Enter the amount actually disbursed.';
        else if (a != null && d > a) errors.amountDisbursedCents = 'The disbursed amount cannot be more than the approved amount.';
        else if (a != null && s === 'Funded' && d !== a) errors.amountDisbursedCents = 'Funded means the full approved amount was paid. Use Partially funded if less was paid.';
        else if (a != null && s === 'Partially funded' && (d <= 0 || d >= a)) errors.amountDisbursedCents = 'Partially funded means more than zero but less than the approved amount.';
      }
    }
  },
  'remaining-items': {
    table: 'remaining_items', type: 'remaining_item', label: 'Remaining-amount item', order: 'sort_order, created_at',
    fields: {
      category: { kind: 'text', max: 200, required: true },
      amountCents: { kind: 'cents', required: true },
      note: { kind: 'text', max: 500 },
      sortOrder: { kind: 'int', min: 0, max: 100000 }
    }
  }
};

// Columns to SELECT (dates as text so they never shift with time zones).
export function selectList(spec) {
  const cols = ['id', 'project_id'];
  for (const [name, rule] of Object.entries(spec.fields)) cols.push(rule.kind === 'date' ? `${col(name)}::text AS ${col(name)}` : col(name));
  cols.push('created_at::text AS created_at', 'updated_at::text AS updated_at');
  return cols.join(', ') + (spec.extraSelect || '');
}

export function toApi(row, spec) {
  const out = { id: row.id };
  for (const [name, rule] of Object.entries(spec.fields)) {
    let v = row[col(name)];
    if (v !== null && v !== undefined && (rule.kind === 'cents' || rule.kind === 'int')) v = Number(v);
    out[name] = v === undefined ? null : v;
  }
  if (row.extended_cents !== undefined) out.extendedCents = Number(row.extended_cents);
  out.createdAt = row.created_at; out.updatedAt = row.updated_at;
  return out;
}

export async function listEntity(q, spec, projectId) {
  const rows = await q.query(`SELECT ${selectList(spec)} FROM ${spec.table} WHERE project_id = $1 ORDER BY ${spec.order}`, [projectId]);
  return rows.map((r) => toApi(r, spec));
}

async function nextRef(q, spec, projectId) {
  const refCol = col(spec.refField);
  const [r] = await q.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(${refCol}, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM ${spec.table} WHERE project_id = $1`, [projectId]);
  return `${spec.refPrefix}-${String(Number(r.n)).padStart(3, '0')}`;
}

function snapshot(api) { const o = { ...api }; delete o.createdAt; delete o.updatedAt; delete o.projectId; return o; }

export async function createEntity(q, actor, project, key, body) {
  const spec = ENTITIES[key];
  const { clean, errors } = cleanFields(body, spec.fields);
  if (spec.rules) spec.rules(clean, errors);
  failIfErrors(errors);
  if (spec.refField) {
    if (!clean[spec.refField]) clean[spec.refField] = await nextRef(q, spec, project.id);
    else if (!/^[A-Za-z0-9._-]{1,30}$/.test(clean[spec.refField])) failIfErrors({ [spec.refField]: 'Use letters, numbers, dots, dashes and underscores only.' });
  }
  if (spec.fields.sortOrder && !clean.sortOrder) {
    const [m] = await q.query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM ${spec.table} WHERE project_id = $1`, [project.id]);
    clean.sortOrder = Number(m.n);
  }
  const names = Object.keys(clean);
  const sql = `INSERT INTO ${spec.table} (project_id, ${names.map(col).join(', ')}) VALUES ($1, ${names.map((_, i) => '$' + (i + 2)).join(', ')}) RETURNING id`;
  const [row] = await q.query(sql, [project.id, ...names.map((n) => clean[n])]);
  await q.query('UPDATE projects SET updated_at = now() WHERE id = $1', [project.id]);
  const [fresh] = await q.query(`SELECT ${selectList(spec)} FROM ${spec.table} WHERE id = $1`, [row.id]);
  const api = toApi(fresh, spec);
  await writeAudit(q, actor, { action: `${spec.type}.create`, entityType: spec.type, entityId: row.id, projectId: project.id,
    summary: `Added ${spec.label.toLowerCase()}${spec.refField ? ' ' + api[spec.refField] : ''}`, after: snapshot(api) });
  return api;
}

export async function updateEntity(q, actor, project, key, id, body) {
  const spec = ENTITIES[key];
  const [existingRow] = await q.query(`SELECT ${selectList(spec)} FROM ${spec.table} WHERE id = $1 AND project_id = $2`, [id, project.id]);
  if (!existingRow) throw new HttpError(404, 'not_found', `That ${spec.label.toLowerCase()} was not found.`);
  const existing = toApi(existingRow, spec);
  const merged = {};
  for (const name of Object.keys(spec.fields)) merged[name] = Object.prototype.hasOwnProperty.call(body, name) ? body[name] : existing[name];
  const { clean, errors } = cleanFields(merged, spec.fields);
  if (spec.rules) spec.rules(clean, errors);
  failIfErrors(errors);
  if (spec.refField && !clean[spec.refField]) clean[spec.refField] = existing[spec.refField];
  const base = {}; for (const n of Object.keys(spec.fields)) base[n] = existing[n];
  const { before, after, changed } = diff(base, clean);
  if (!changed) return existing;
  const names = Object.keys(after);
  await q.query(`UPDATE ${spec.table} SET ${names.map((n, i) => `${col(n)} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND project_id = $2`,
    [id, project.id, ...names.map((n) => after[n])]);
  await q.query('UPDATE projects SET updated_at = now() WHERE id = $1', [project.id]);
  const [fresh] = await q.query(`SELECT ${selectList(spec)} FROM ${spec.table} WHERE id = $1`, [id]);
  const api = toApi(fresh, spec);
  await writeAudit(q, actor, { action: `${spec.type}.update`, entityType: spec.type, entityId: id, projectId: project.id,
    summary: `Edited ${spec.label.toLowerCase()}${spec.refField ? ' ' + api[spec.refField] : ''} (${names.join(', ')})`, before, after });
  return api;
}

export async function deleteEntity(q, actor, project, key, id) {
  const spec = ENTITIES[key];
  const [row] = await q.query(`SELECT ${selectList(spec)} FROM ${spec.table} WHERE id = $1 AND project_id = $2`, [id, project.id]);
  if (!row) throw new HttpError(404, 'not_found', `That ${spec.label.toLowerCase()} was not found.`);
  const api = toApi(row, spec);
  // Evidence is never deleted silently: attached documents stay on the project, just unlinked.
  const linkType = { expenses: 'expense', supplements: 'supplement', draws: 'draw' }[key];
  let unlinked = 0;
  if (linkType) {
    const r = await q.query('UPDATE documents SET linked_type = NULL, linked_id = NULL WHERE linked_type = $1 AND linked_id = $2 RETURNING id', [linkType, id]);
    unlinked = r.length;
  }
  await q.query(`DELETE FROM ${spec.table} WHERE id = $1`, [id]);
  await q.query('UPDATE projects SET updated_at = now() WHERE id = $1', [project.id]);
  await writeAudit(q, actor, { action: `${spec.type}.delete`, entityType: spec.type, entityId: id, projectId: project.id,
    summary: `Deleted ${spec.label.toLowerCase()}${spec.refField ? ' ' + api[spec.refField] : ''}${unlinked ? ` (${unlinked} attached document(s) kept)` : ''}`, before: snapshot(api) });
  return { deleted: true, unlinkedDocuments: unlinked };
}
