/* FCV portal: shared shell (templating, API client, sign-in flow, profile menu, drawers, toasts). */
(function () {
  'use strict';
  const FCV = (window.FCV = {});

  /* -------------------------------------------------------------- safe templates */
  // Everything interpolated into html`...` is HTML-escaped automatically.
  // Only raw(...) (and nested html`...`) is trusted. Customer-typed text can never inject markup.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(String(s));
  const part = (v) => (v == null || v === false || v === true ? '' : Array.isArray(v) ? v.map(part).join('') : v instanceof Raw ? v.s : esc(v));
  const html = (strings, ...vals) => { let out = ''; strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); }); return new Raw(out); };
  const mount = (el, tpl) => { el.innerHTML = String(tpl); return el; };
  Object.assign(FCV, { esc, raw, html, mount });

  /* ------------------------------------------------------------------ formatting */
  const money = (c) => {
    if (c === null || c === undefined || c === '') return '—';
    const n = Number(c); const neg = n < 0; const a = Math.abs(n);
    return (neg ? '−' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0');
  };
  const dateOnly = (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); if (!m) return '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const parseTs = (iso) => new Date(String(iso || '').replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  const dateTime = (iso) => { const d = parseTs(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const pct = (r, d = 2) => (r === null || r === undefined ? '—' : (r * 100).toFixed(d) + '%');
  const qty = (s) => { const n = Number(s); return Number.isFinite(n) ? String(n) : String(s || ''); };
  const initials = (nameOrEmail) => { const s = String(nameOrEmail || '?').trim(); const parts = s.includes('@') ? s.split('@')[0].split(/[._-]+/) : s.split(/\s+/); return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase(); };
  const ago = (iso) => { const d = parseTs(iso); const s = (Date.now() - d.getTime()) / 1000; if (!(s >= 0)) return dateTime(iso); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' hr ago'; if (s < 172800) return 'yesterday'; return dateTime(iso); };
  // dollars text -> cents, exactly (no floating point). Returns null when blank, NaN when invalid.
  const toCents = (txt) => {
    const s = String(txt == null ? '' : txt).replace(/[$,\s]/g, ''); if (s === '') return null;
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    const [d, f = ''] = s.split('.'); return Number(d) * 100 + Number((f + '00').slice(0, 2));
  };
  const fromCents = (c) => (c === null || c === undefined ? '' : (Number(c) / 100).toFixed(2));
  Object.assign(FCV, { money, dateOnly, dateTime, pct, qty, initials, ago, toCents, fromCents });

  /* ------------------------------------------------------------------------ icons */
  const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const icons = {
    back: I('<path d="M19 12H5M11 18l-6-6 6-6"/>'), arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'), check: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    chev: I('<path d="m6 9 6 6 6-6"/>'), x: I('<path d="M18 6 6 18M6 6l12 12"/>'), plus: I('<path d="M12 5v14M5 12h14"/>'),
    edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'), trash: I('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>'),
    clip: I('<path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/>'), download: I('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
    print: I('<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z"/>'),
    list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'), user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    users: I('<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M17 4.5a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3"/>'),
    out: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'), shield: I('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
    lock: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'), eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    doc: I('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'), info: I('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'),
    alert: I('<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18h.01"/>'), search: I('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    upload: I('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'), refresh: I('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12A9 9 0 0 1 18.5 5.8L21 8M21 3v5h-5M3 21v-5h5"/>'),
    mail: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'), phone: I('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
    grid: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    inbox: I('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>'), history: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>'),
    pulse: I('<path d="M3 12h4l3-8 4 16 3-8h4"/>'), building: I('<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>'),
    link: I('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>')
  };
  FCV.icons = icons; FCV.icon = (n) => raw(icons[n] || '');

  /* ---------------------------------------------------------------------- API client */
  class ApiError extends Error {
    constructor(status, body) { super((body && body.error && body.error.message) || 'Something went wrong. Please try again.'); this.status = status; this.code = body && body.error && body.error.code; this.details = body && body.error && body.error.details; }
  }
  FCV.ApiError = ApiError;
  FCV.api = async (method, path, body) => {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, init); } catch { throw new ApiError(0, { error: { code: 'network', message: 'Could not reach the server. Check your connection and try again.' } }); }
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
    if (!res.ok) { if (res.status === 401 && FCV.onSessionLost) FCV.onSessionLost(); throw new ApiError(res.status, data); }
    return data;
  };

  /* --------------------------------------------------------------------- toasts, drawers */
  FCV.toast = (msg, kind = '') => {
    let box = document.querySelector('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, kind === 'bad' ? 7000 : 3600);
  };

  let openDrawer = null;
  FCV.drawer = {
    open({ title, subtitle = '', body = '', footer = '', onClose, wide = false }) {
      if (openDrawer) openDrawer.close(true);
      const scrim = document.createElement('div'); scrim.className = 'scrim';
      const el = document.createElement('aside'); el.className = 'drawer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title);
      if (wide) el.style.width = 'min(820px,100%)';
      el.innerHTML = String(html`<div class="drawer-head"><div><h3>${title}</h3>${subtitle ? html`<p>${subtitle}</p>` : ''}</div><button class="icon-btn" data-close aria-label="Close">${icons.x ? raw(icons.x) : ''}</button></div><div class="drawer-body"></div><div class="drawer-foot"></div>`);
      el.querySelector('.drawer-body').innerHTML = String(body); const foot = el.querySelector('.drawer-foot'); foot.innerHTML = String(footer); if (!String(footer)) foot.remove();
      document.body.append(scrim, el); document.body.style.overflow = 'hidden';
      const prevFocus = document.activeElement;
      const ctrl = {
        el, body: el.querySelector('.drawer-body'), foot,
        close(force) { if (!force && ctrl.beforeClose && ctrl.beforeClose() === false) return; scrim.remove(); el.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); openDrawer = null; if (onClose) onClose(); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch { /* gone */ } }
      };
      const onKey = (e) => { if (e.key === 'Escape') ctrl.close(); };
      document.addEventListener('keydown', onKey);
      scrim.addEventListener('click', () => ctrl.close()); el.querySelector('[data-close]').addEventListener('click', () => ctrl.close());
      openDrawer = ctrl; setTimeout(() => { const f = el.querySelector('input:not([type=hidden]),select,textarea,button.btn'); if (f) f.focus(); }, 60);
      return ctrl;
    },
    close() { if (openDrawer) openDrawer.close(true); }
  };

  FCV.confirm = ({ title, message, confirmLabel = 'Confirm', danger = false, requireText = '' }) => new Promise((resolve) => {
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.style.zIndex = 70;
    const d = document.createElement('div'); d.className = 'dialog'; d.style.zIndex = 71; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML = String(html`<h3>${title}</h3><p>${message}</p>${requireText ? html`<label class="field" style="margin:-6px 0 20px"><span class="l">Type <b class="mono">${requireText}</b> to confirm</span><input class="input" data-confirm-text autocomplete="off"></label>` : ''}<div class="btns"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'gold'}" data-yes ${requireText ? 'disabled' : ''}>${confirmLabel}</button></div>`);
    document.body.append(scrim, d);
    const done = (v) => { scrim.remove(); d.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    d.querySelector('[data-no]').onclick = () => done(false); d.querySelector('[data-yes]').onclick = () => done(true); scrim.onclick = () => done(false);
    const inp = d.querySelector('[data-confirm-text]');
    if (inp) { inp.addEventListener('input', () => { d.querySelector('[data-yes]').disabled = inp.value.trim().toUpperCase() !== requireText.toUpperCase(); }); inp.focus(); } else d.querySelector('[data-no]').focus();
  });

  /* ------------------------------------------------------------------- sign-in shell */
  const Auth = () => window.FCVAuth;
  const BRAND_LOGO = '/Images/FCV%20Logo%20-%20Dark%20Mode.png';

  function authLayout(inner, { headline = '', lead = '' } = {}) {
    return html`<div class="auth"><section class="auth-brand"><img class="logo" src="${BRAND_LOGO}" alt="FCV Restoration &amp; Construction">
      <div><span class="eyebrow">Client &amp; Lender Portal</span><h1 class="display" style="margin-top:16px">${raw(headline || 'Every dollar, every draw, <em>in plain sight.</em>')}</h1><p class="lead" style="margin-top:18px">${lead || 'A private, read-only view of your project’s costs, funding draws and receipts, kept by FCV Restoration & Construction.'}</p></div>
      <div class="assure"><div>${raw(icons.shield)}<span><b>Invitation only</b>Accounts are created by FCV. There is no public sign-up.</span></div><div>${raw(icons.eye)}<span><b>View-only for clients and lenders</b>Only FCV’s administrator can add or change records.</span></div><div>${raw(icons.history)}<span><b>Every change is on record</b>A permanent audit trail shows who changed what, and when.</span></div></div></section>
      <section class="auth-form"><div class="auth-card">${inner}</div></section></div>`;
  }
  const pwScore = (p) => { let s = 0; if (p.length >= 10) s++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p) || p.length >= 16) s++; return s; };

  function showLogin(root, ctx, notice = '') {
    mount(root, authLayout(html`<h2>Welcome back</h2><p class="lead">Sign in to see your project.</p>
      <form class="card gold-edge stack" data-login novalidate style="--gap:18px">
        ${notice ? html`<div class="callout"><span>${raw(icons.info)}</span><p>${notice}</p></div>` : ''}
        <div data-err></div>
        <label class="field"><span class="l">Email</span><input class="input" type="email" name="email" autocomplete="username" required autofocus placeholder="you@example.com"></label>
        <label class="field"><span class="l">Password</span><input class="input" type="password" name="password" autocomplete="current-password" required placeholder="Your password"></label>
        <button class="btn gold block" type="submit">Sign in ${raw(icons.arrow)}</button>
        <div class="center"><button class="link-btn" type="button" data-forgot>Forgot your password?</button></div>
      </form>
      <p class="auth-foot">Need access? Contact <a href="mailto:quote@fcvrestoration.com">quote@fcvrestoration.com</a><br>FCV Restoration &amp; Construction</p>`));
    const form = root.querySelector('[data-login]'); const err = form.querySelector('[data-err]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.innerHTML = '';
      const email = form.email.value.trim(); const pw = form.password.value;
      if (!email || !pw) { err.innerHTML = String(html`<div class="form-error">Enter your email and password.</div>`); return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.firstChild.textContent = 'Signing in… ';
      try { await Auth().login(email, pw); await proceed(root, ctx); }
      catch (ex) { btn.disabled = false; btn.firstChild.textContent = 'Sign in '; err.innerHTML = String(html`<div class="form-error">That email and password don’t match. If you were just invited, open the link in your invitation email to choose a password first.</div>`); form.password.select(); }
    });
    form.querySelector('[data-forgot]').addEventListener('click', () => showForgot(root, ctx, form.email.value.trim()));
  }

  function showForgot(root, ctx, email = '') {
    mount(root, authLayout(html`<h2>Reset your password</h2><p class="lead">Enter your email and we’ll send you a link to choose a new one.</p>
      <form class="card gold-edge stack" data-forgot-form novalidate style="--gap:18px"><div data-msg></div>
        <label class="field"><span class="l">Email</span><input class="input" type="email" name="email" autocomplete="username" required autofocus value="${email}"></label>
        <button class="btn gold block" type="submit">Send reset link</button><div class="center"><button class="link-btn" type="button" data-back>Back to sign in</button></div></form>`));
    const form = root.querySelector('[data-forgot-form]'); const msg = form.querySelector('[data-msg]');
    form.querySelector('[data-back]').onclick = () => showLogin(root, ctx);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const v = form.email.value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { msg.innerHTML = String(html`<div class="form-error">Enter a valid email address.</div>`); return; }
      form.querySelector('button[type=submit]').disabled = true;
      try { await Auth().requestPasswordRecovery(v); } catch { /* never reveal whether an account exists */ }
      msg.innerHTML = String(html`<div class="callout ok"><span>${raw(icons.check)}</span><p>If that address has a portal account, a reset link is on its way. It can take a minute to arrive.</p></div>`);
    });
  }

  function showSetPassword(root, ctx, { mode, token }) {
    const invite = mode === 'invite';
    mount(root, authLayout(html`<h2>${invite ? 'Welcome. Choose your password' : 'Choose a new password'}</h2><p class="lead">${invite ? 'You’ve been invited to the FCV Client & Lender Portal. Set a password to finish creating your account.' : 'Pick a strong password you haven’t used elsewhere.'}</p>
      <form class="card gold-edge stack" data-setpw novalidate style="--gap:18px"><div data-err></div>
        <label class="field"><span class="l">New password</span><input class="input" type="password" name="pw" autocomplete="new-password" required autofocus><div class="pw-meter" data-meter><i></i><i></i><i></i><i></i></div><span class="help">At least 10 characters. A mix of letters, numbers and symbols is best.</span></label>
        <label class="field"><span class="l">Confirm password</span><input class="input" type="password" name="pw2" autocomplete="new-password" required></label>
        <button class="btn gold block" type="submit">${invite ? 'Create my account' : 'Save new password'} ${raw(icons.arrow)}</button></form>`, { headline: invite ? 'Your project, <em>made transparent.</em>' : 'Almost <em>there.</em>' }));
    const form = root.querySelector('[data-setpw]'); const err = form.querySelector('[data-err]'); const meter = form.querySelector('[data-meter]');
    form.pw.addEventListener('input', () => { const s = pwScore(form.pw.value); meter.className = 'pw-meter s' + s; [...meter.children].forEach((c, i) => c.classList.toggle('on', i < s)); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.innerHTML = '';
      if (form.pw.value.length < 10) { err.innerHTML = String(html`<div class="form-error">Use at least 10 characters.</div>`); return; }
      if (form.pw.value !== form.pw2.value) { err.innerHTML = String(html`<div class="form-error">The two passwords don’t match.</div>`); return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try { if (invite) await Auth().acceptInvite(token, form.pw.value); else await Auth().updateUser({ password: form.pw.value }); await proceed(root, ctx); }
      catch (ex) { btn.disabled = false; err.innerHTML = String(html`<div class="form-error">${ex && ex.message ? 'We couldn’t save that password: ' + ex.message : 'We couldn’t save that password. The link may have expired. Ask FCV to resend your invitation.'}</div>`); }
    });
  }

  function showBlocked(root, ctx, { title, message, extra = '' }) {
    mount(root, authLayout(html`<h2>${title}</h2><p class="lead">${message}</p><div class="card stack">${raw(extra)}<button class="btn block" data-signout>${raw(icons.out)} Sign out</button><a class="btn ghost block" href="mailto:quote@fcvrestoration.com">${raw(icons.mail)} Contact FCV</a></div>`, { headline: 'This area is <em>private.</em>' }));
    root.querySelector('[data-signout]').onclick = async () => { try { await Auth().logout(); } catch { /* already out */ } showLogin(root, ctx); };
  }

  function topbar(user, area) {
    const admin = area === 'admin';
    const items = admin
      ? html`<a href="/admin/#/projects">${raw(icons.building)} Projects</a><a href="/admin/#/requests">${raw(icons.inbox)} Quote requests</a><a href="/admin/#/people">${raw(icons.users)} People &amp; invitations</a><a href="/admin/#/audit">${raw(icons.history)} Audit log</a><a href="/portal/">${raw(icons.eye)} Client view</a><div class="rule"></div>`
      : html`<a href="/portal/#/">${raw(icons.list)} My requests</a>${user.role === 'admin' ? html`<a href="/admin/">${raw(icons.shield)} Administration</a>` : ''}<div class="rule"></div>`;
    return html`<header class="topbar"><div class="topbar-in">
      <a class="brand" href="${admin ? '/admin/' : '/portal/'}"><img src="${BRAND_LOGO}" alt="FCV Restoration &amp; Construction"><span class="sep"></span><span class="label"><b>${admin ? 'Administration' : 'Client & Lender Portal'}</b>${admin ? 'Full access' : 'Read-only view'}</span></a>
      <nav class="top-nav" id="topnav" aria-label="Main"></nav><div class="spacer"></div>
      <div class="profile"><button class="avatar-btn" id="avatarBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu"><span class="avatar">${initials(user.name || user.email)}</span>${raw(icons.chev.replace('<svg', '<svg class="chev"'))}</button>
        <div class="menu" id="profileMenu" role="menu" hidden><div class="menu-head"><span class="avatar">${initials(user.name || user.email)}</span><div class="who"><b>${user.name || user.email.split('@')[0]}</b><span>${user.email}</span><span style="margin-top:6px">${admin || user.role === 'admin' ? html`<span class="chip gold">Administrator</span>` : html`<span class="chip">Read-only member</span>`}</span></div></div>
        ${items}<button class="item" role="menuitem" id="signOutBtn">${raw(icons.out)} Sign out</button></div></div></div></header>`;
  }

  function wireTopbar(root, ctx) {
    const btn = root.querySelector('#avatarBtn'); const menu = root.querySelector('#profileMenu');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) { const f = menu.querySelector('a,button'); if (f) f.focus(); } });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
    root.querySelector('#signOutBtn').onclick = async () => { try { await Auth().logout(); } catch { /* ignore */ } FCV.state = {}; showLogin(document.getElementById('app'), ctx, 'You have been signed out.'); };
  }

  // Everything after a successful sign-in: ask the server who we are (and whether we're allowed), then build the app.
  async function proceed(root, ctx) {
    let me;
    try { me = await FCV.api('GET', '/api/me'); }
    catch (e) {
      if (e.status === 401) return showLogin(root, ctx);
      if (e.status === 403) return showBlocked(root, ctx, { title: e.code === 'disabled' ? 'Account disabled' : 'No portal access yet', message: e.message });
      return showBlocked(root, ctx, { title: 'Something went wrong', message: e.message });
    }
    if (ctx.area === 'admin' && me.user.role !== 'admin') {
      return showBlocked(root, ctx, { title: 'Administrators only', message: 'This area is only for the FCV administrator.', extra: String(html`<a class="btn gold block" href="/portal/">${raw(icons.eye)} Go to my portal</a>`) });
    }
    FCV.me = me.user; FCV.stages = me.stages;
    mount(root, html`${topbar(me.user, ctx.area)}<main class="wrap" id="view" tabindex="-1"></main>`);
    wireTopbar(root, ctx);
    FCV.onSessionLost = () => { FCV.drawer.close(); showLogin(document.getElementById('app'), ctx, 'Your session ended. Please sign in again.'); };
    await ctx.onReady({ me: me.user, view: root.querySelector('#view'), nav: root.querySelector('#topnav') });
  }

  FCV.start = async function start(ctx) {
    const root = document.getElementById('app');
    mount(root, html`<div class="splash"><div class="pulse"></div></div>`);
    if (!Auth()) { mount(root, html`<div class="splash"><p class="muted">The sign-in module failed to load. Please refresh.</p></div>`); return; }
    let cb = null; let cbErr = null;
    try { cb = await Auth().handleAuthCallback(); } catch (e) { cbErr = e; }
    if (/(invite_token|recovery_token|confirmation_token|email_change_token|access_token)=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    if (cb && cb.type === 'invite') return showSetPassword(root, ctx, { mode: 'invite', token: cb.token });
    if (cb && cb.type === 'recovery') return showSetPassword(root, ctx, { mode: 'recovery' });
    if (cbErr) return showLogin(root, ctx, 'That link has expired or was already used. Use “Forgot your password?” for a new one, or ask FCV to resend your invitation.');
    let u = null; try { u = await Auth().getUser(); } catch { /* not signed in */ }
    if (!u) return showLogin(root, ctx);
    return proceed(root, ctx);
  };

  /* --------------------------------------------------------------------- hash router */
  FCV.route = () => { const h = (location.hash || '#/').replace(/^#\/?/, ''); return h.split('/').filter(Boolean).map(decodeURIComponent); };
  FCV.onRoute = (fn) => { window.addEventListener('hashchange', fn); };
})();
