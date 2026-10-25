// TEST ONLY. A stand-in for the @netlify/identity browser SDK, talking to the local dev server.
// The real SDK is used in production (portal/assets/identity.js is built from the real package).
const KEY = 'fcv_mock_user';
const listeners = new Set();
const emit = (e, u) => listeners.forEach((f) => f(e, u));
async function post(path, body) {
  const r = await fetch('/__mock/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'failed'), { status: r.status });
  return j;
}
const setSession = (u, token) => { localStorage.setItem(KEY, JSON.stringify(u)); document.cookie = 'nf_jwt=' + token + '; path=/; SameSite=Lax'; };
export async function login(email, password) { const j = await post('login', { email, password }); setSession(j.user, j.token); emit('login', j.user); return j.user; }
export async function logout() { localStorage.removeItem(KEY); document.cookie = 'nf_jwt=; path=/; max-age=0'; emit('logout', null); }
export async function getUser() { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; }
export async function handleAuthCallback() {
  const h = location.hash; let m;
  if ((m = /invite_token=([^&]+)/.exec(h))) return { type: 'invite', user: null, token: m[1] };
  if ((m = /recovery_token=([^&]+)/.exec(h))) { const j = await post('recovery', { token: m[1] }); setSession(j.user, j.token); emit('recovery', j.user); return { type: 'recovery', user: j.user }; }
  return null;
}
export async function acceptInvite(token, password) { const j = await post('accept', { token, password }); setSession(j.user, j.token); emit('login', j.user); return j.user; }
export async function requestPasswordRecovery(email) { await post('request-recovery', { email }); }
export async function updateUser({ password }) { const j = await post('update-password', { password }); return j.user; }
export const onAuthChange = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
