// People and invitations. Authentication lives in Netlify Identity; permission to use the portal lives here.
import { HttpError } from './http.mjs';
import { writeAudit } from './audit.mjs';
import { adminAllowlist } from './auth.mjs';
import { getIdentityConfig, identityAdmin } from './identity.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normEmail = (e) => String(e || '').trim().toLowerCase();

async function identityUsers() {
  try {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await identityAdmin().listUsers({ page, perPage: 100 });
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  } catch { return null; }
}

// The SDK has no "invite" helper, so this calls the same admin endpoint the Netlify dashboard uses.
async function sendIdentityInvite(email) {
  const cfg = getIdentityConfig();
  if (!cfg || !cfg.url || !cfg.token) throw new HttpError(502, 'identity_unavailable', 'Netlify Identity is not available to this function.');
  const res = await fetch(`${cfg.url}/invite`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (res.ok) return { sent: true };
  const body = await res.json().catch(() => ({}));
  const msg = String(body.msg || body.message || body.error_description || '');
  if (/already (been )?(registered|exists)|already invited/i.test(msg)) return { sent: false, existing: true };
  throw new HttpError(502, 'identity_invite_failed', msg || `Netlify Identity refused the invitation (${res.status}).`);
}

export async function listUsers(db) {
  const rows = await db.query(
    `SELECT u.email, u.role, u.status, u.display_name, u.invited_by, u.invited_at::text AS invited_at, u.last_login_at::text AS last_login_at,
            COALESCE((SELECT count(*)::int FROM project_members m WHERE m.email = u.email), 0) AS projects
     FROM portal_users u ORDER BY u.role, u.email`);
  const idu = await identityUsers();
  const byEmail = new Map((idu || []).map((u) => [normEmail(u.email), u]));
  const allow = adminAllowlist();
  return {
    identityChecked: idu !== null,
    users: rows.map((r) => {
      const i = byEmail.get(r.email);
      return { email: r.email, name: r.display_name, role: allow.has(r.email) && r.role === 'admin' ? 'admin' : 'member', status: r.status,
        invitedBy: r.invited_by, invitedAt: r.invited_at, lastLoginAt: r.last_login_at, projects: Number(r.projects),
        accepted: i ? !!i.confirmedAt : null, designatedAdmin: allow.has(r.email) };
    })
  };
}

export async function inviteUser(db, actor, { email, name, projectIds }) {
  const e = normEmail(email);
  if (!EMAIL.test(e)) throw new HttpError(400, 'validation', 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  if (adminAllowlist().has(e)) throw new HttpError(400, 'is_admin', 'That address is the designated administrator. Invite them from Netlify (Identity → Invite users) the first time.');
  const ids = Array.isArray(projectIds) ? projectIds.slice(0, 50) : [];
  const fresh = await db.tx(async (q) => {
    const [existing] = await q.query('SELECT status FROM portal_users WHERE email = $1', [e]);
    if (existing) return false;
    await q.query(`INSERT INTO portal_users (email, role, status, display_name, invited_by) VALUES ($1,'member','invited',$2,$3)`, [e, String(name || '').slice(0, 120), actor.email]);
    for (const pid of ids) await q.query('INSERT INTO project_members (project_id, email, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [pid, e, actor.email]);
    await writeAudit(q, actor, { action: 'user.invite', entityType: 'user', entityId: e, summary: `Invited ${e} as a read-only member`, after: { email: e, role: 'member', projectIds: ids } });
    return true;
  });
  if (!fresh) throw new HttpError(409, 'already_invited', 'That person has already been invited. Use Resend if they have not accepted yet.');
  try {
    const r = await sendIdentityInvite(e);
    return { email: e, emailSent: r.sent, note: r.existing ? 'That person already has a login. They can sign in with it.' : undefined };
  } catch (err) {
    if (err instanceof HttpError) {
      // Saved, but the email could not be sent automatically. The admin can invite from the Netlify dashboard instead.
      return { email: e, emailSent: false, warning: `Saved, but the invitation email could not be sent automatically (${err.message}). Invite ${e} from Netlify (Identity → Invite users); they will be recognised as soon as they accept.` };
    }
    throw err;
  }
}

export async function resendInvite(db, actor, email) {
  const e = normEmail(email);
  const [u] = await db.query('SELECT status FROM portal_users WHERE email = $1', [e]);
  if (!u) throw new HttpError(404, 'not_found', 'That person was not found.');
  const idu = await identityUsers();
  const found = (idu || []).find((x) => normEmail(x.email) === e);
  if (found && found.confirmedAt) throw new HttpError(409, 'already_accepted', 'That person has already accepted. If they forgot their password, they can use “Forgot password” on the sign-in page.');
  if (found) await identityAdmin().deleteUser(found.id);   // an unaccepted invite can only be re-sent by replacing it
  const r = await sendIdentityInvite(e);
  await db.tx((q) => writeAudit(q, actor, { action: 'user.resend_invite', entityType: 'user', entityId: e, summary: `Re-sent the invitation to ${e}` }));
  return { email: e, emailSent: r.sent };
}

function guardTarget(actor, e) {
  if (e === actor.email) throw new HttpError(400, 'self', 'You cannot change your own account here.');
  if (adminAllowlist().has(e)) throw new HttpError(400, 'is_admin', 'The designated administrator cannot be changed from the portal.');
}

export async function setUserStatus(db, actor, email, status) {
  const e = normEmail(email); guardTarget(actor, e);
  if (!['active', 'disabled'].includes(status)) throw new HttpError(400, 'validation', 'Unknown status.');
  return db.tx(async (q) => {
    const [u] = await q.query('SELECT status, identity_id FROM portal_users WHERE email = $1', [e]);
    if (!u) throw new HttpError(404, 'not_found', 'That person was not found.');
    const next = status === 'disabled' ? 'disabled' : (u.identity_id ? 'active' : 'invited');
    await q.query('UPDATE portal_users SET status = $2 WHERE email = $1', [e, next]);
    await writeAudit(q, actor, { action: status === 'disabled' ? 'user.disable' : 'user.enable', entityType: 'user', entityId: e, summary: `${status === 'disabled' ? 'Disabled' : 'Re-enabled'} ${e}`, before: { status: u.status }, after: { status: next } });
    return { email: e, status: next };
  });
}

export async function removeUser(db, actor, email) {
  const e = normEmail(email); guardTarget(actor, e);
  const gone = await db.tx(async (q) => {
    const [u] = await q.query('SELECT * FROM portal_users WHERE email = $1', [e]);
    if (!u) throw new HttpError(404, 'not_found', 'That person was not found.');
    const proj = await q.query('DELETE FROM project_members WHERE email = $1 RETURNING project_id', [e]);
    await q.query('DELETE FROM portal_users WHERE email = $1', [e]);
    await writeAudit(q, actor, { action: 'user.remove', entityType: 'user', entityId: e, summary: `Removed ${e} and all their project access`, before: { email: e, role: u.role, status: u.status, projectIds: proj.map((r) => r.project_id) } });
    return u;
  });
  let identityRemoved = null;
  try {
    const idu = await identityUsers();
    const found = (idu || []).find((x) => normEmail(x.email) === e);
    if (found) { await identityAdmin().deleteUser(found.id); identityRemoved = true; } else identityRemoved = idu === null ? null : false;
  } catch { identityRemoved = null; }
  return { email: gone.email, removed: true, loginRemoved: identityRemoved };
}
