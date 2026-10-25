// Who is calling, and what are they allowed to do? Decided on the server, on every request.
//  - Authentication: Netlify Identity (a valid signed-in session).
//  - Authorization: this database. A person must have been invited (a portal_users row) and not disabled.
//    Admin = invited as admin AND listed in the FCV_ADMIN_EMAILS environment variable (the "designated admin").
import { getUser, verifyRequestOrigin } from './identity.mjs';
import { HttpError } from './http.mjs';
import { writeAudit } from './audit.mjs';

export function adminAllowlist() {
  return new Set((process.env.FCV_ADMIN_EMAILS || '').split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export async function requireUser(db, ip = '') {
  const idUser = await getUser();
  if (!idUser || !idUser.email) throw new HttpError(401, 'not_signed_in', 'Please sign in.');
  const email = String(idUser.email).toLowerCase();
  const allow = adminAllowlist();
  const name = (idUser.name || (idUser.userMetadata && (idUser.userMetadata.full_name || idUser.userMetadata.name)) || '').toString().slice(0, 120);

  const row = await db.tx(async (q) => {
    let [u] = await q.query('SELECT * FROM portal_users WHERE email = $1', [email]);
    if (!u && allow.has(email)) {
      // First sign-in of the designated admin: create their record.
      [u] = await q.query(
        `INSERT INTO portal_users (email, role, status, display_name, identity_id, last_login_at)
         VALUES ($1,'admin','active',$2,$3, now()) RETURNING *`, [email, name, idUser.id || null]);
      await writeAudit(q, { email, role: 'admin', ip }, { action: 'user.bootstrap_admin', entityType: 'user', entityId: email, summary: 'Designated admin signed in for the first time' });
      return u;
    }
    if (!u) return null;
    if (u.status === 'disabled') return u;
    // Keep a light record of sign-ins (at most once every 10 minutes to avoid write noise).
    const stale = !u.last_login_at || (Date.now() - new Date(u.last_login_at).getTime() > 10 * 60 * 1000);
    if (u.status === 'invited' || stale || (idUser.id && u.identity_id !== idUser.id) || (name && !u.display_name)) {
      [u] = await q.query(
        `UPDATE portal_users SET status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
                identity_id = COALESCE($2, identity_id), display_name = CASE WHEN display_name = '' THEN $3 ELSE display_name END,
                last_login_at = now()
         WHERE email = $1 RETURNING *`, [email, idUser.id || null, name]);
    }
    return u;
  });

  if (!row) throw new HttpError(403, 'not_invited', 'This account has not been invited to the portal. Please contact FCV Restoration & Construction.');
  if (row.status === 'disabled') throw new HttpError(403, 'disabled', 'This account has been disabled. Please contact FCV Restoration & Construction.');

  const isAdmin = row.role === 'admin' && allow.has(email);
  return { email, name: row.display_name || name, role: isAdmin ? 'admin' : 'member', ip };
}

export function requireAdmin(user) {
  if (!user || user.role !== 'admin') throw new HttpError(403, 'admin_only', 'Only the designated administrator can do that.');
}

// Browser sessions use a cookie, so every state-changing request must come from our own pages.
export function guardMutation(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  try { verifyRequestOrigin(req); } catch (e) { throw new HttpError(403, 'bad_origin', 'That request did not come from this site.'); }
}
