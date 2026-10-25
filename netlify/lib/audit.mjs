// Audit history. Always written inside the same transaction as the change it describes,
// so a change can never exist without its audit entry (and the table is append-only in the database).
export async function writeAudit(q, actor, ev) {
  await q.query(
    `INSERT INTO audit_log (actor_email, actor_role, action, entity_type, entity_id, project_id, summary, before, after, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
    [
      actor.email, actor.role, ev.action, ev.entityType || '', ev.entityId ? String(ev.entityId) : '',
      ev.projectId || null, (ev.summary || '').slice(0, 300),
      ev.before === undefined || ev.before === null ? null : JSON.stringify(ev.before),
      ev.after === undefined || ev.after === null ? null : JSON.stringify(ev.after),
      actor.ip || ''
    ]
  );
}

// Which keys differ between `existing` and `next`? Returns { before, after } with only the changed keys.
export function diff(existing, next) {
  const before = {}; const after = {};
  for (const k of Object.keys(next)) {
    const a = existing[k]; const b = next[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) { before[k] = a === undefined ? null : a; after[k] = b; }
  }
  return { before, after, changed: Object.keys(after).length > 0 };
}
