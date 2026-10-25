/* track.html: the customer's private page. Opened from the link in their email (track.html?k=...). */
(function () {
  'use strict';
  var A = window.FCVApp, T = window.FCVTracker, html = A.html, raw = A.raw, I = A.icons, $ = A.$;
  var app = document.getElementById('app');
  var KEY = 'fcv_tokens';                                   // {token, ref, title}[] remembered on this device
  var state = { token: null, data: null, me: null, tab: 'summary' };

  function saved() { try { return JSON.parse(A.store.get(KEY) || '[]').filter(function (x) { return x && /^[a-f0-9]{32}$/.test(x.token); }); } catch (e) { return []; } }
  function remember(token, ref, title, name) {
    var list = saved().filter(function (x) { return x.token !== token; });
    list.unshift({ token: token, ref: ref, title: title || '', name: name || '' });
    A.store.set(KEY, JSON.stringify(list.slice(0, 12)));
  }
  function forget(token) { A.store.set(KEY, JSON.stringify(saved().filter(function (x) { return x.token !== token; }))); }
  function qsToken() { var m = /[?&]k=([a-f0-9]{32})\b/i.exec(location.search); return m ? m[1].toLowerCase() : null; }
  function hashRoute() { return (location.hash || '').replace(/^#\/?/, ''); }

  function shell(inner, hero) {
    A.mount(app, html`<div class="fcv-wrap">${hero || ''}${inner}</div>`);
  }
  function heroBlock(eyebrow, title, lead, right) {
    return html`<div class="fcv-hero"><div><span class="fcv-eyebrow">${eyebrow}</span><h1 class="fcv-title">${title}</h1>${lead ? html`<p class="fcv-lead">${lead}</p>` : ''}</div>${right || ''}</div>`;
  }

  /* ------------------------------ sign in ------------------------------ */
  function showSignIn(note) {
    var list = saved();
    document.title = 'Sign in - Track My Request';
    shell(html`<div class="fcv-signin fcv-stack">
      ${note ? html`<div class="fcv-callout bad">${raw(I.alert)}<p>${note}</p></div>` : ''}
      <section class="fcv-card edge"><h2 class="fcv-h2">Find my request</h2>
        <p class="muted" style="margin:10px 0 22px">Enter the email address you used on our website. We’ll email you a private link to every request under it. There’s no password to remember.</p>
        <form id="sl" class="fcv-stack" style="--gap:16px" novalidate>
          <div class="fcv-field"><label for="em">Email address</label><input class="fcv-input" id="em" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required></div>
          <p class="fcv-err" id="slerr" role="alert" hidden></p>
          <button class="fcv-btn primary" id="slbtn" type="submit">${raw(I.mail)} Email me my link</button>
        </form>
        <div id="slok" class="fcv-callout ok" hidden style="margin-top:18px">${raw(I.check)}<p id="slmsg"></p></div>
      </section>
      ${list.length ? html`<section class="fcv-card"><h3 class="fcv-h3">On this device</h3><div class="fcv-saved">${list.map(function (x) {
        return html`<a href="track.html?k=${x.token}"><span><b>${x.title || 'Your request'}</b><br><span class="muted" style="font-size:13px">${x.name ? x.name + ' · ' : ''}${x.ref}</span></span>${raw(I.arrow.replace('<svg', '<svg style="width:18px;height:18px"'))}</a>`; })}</div></section>` : ''}
      <p class="muted" style="text-align:center;font-size:14px">Can’t find the email? Check your spam folder, or call us on <a href="tel:+13132932280" style="text-decoration:underline">(313) 293-2280</a>.</p>
    </div>`, heroBlock('Customer area', 'Track my request', 'See where your request stands, your quote, when work can start and, once work begins, the full project tracker.'));
    $('#sl').addEventListener('submit', function (e) {
      e.preventDefault();
      var em = $('#em').value.trim(), err = $('#slerr'), btn = $('#slbtn');
      err.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { err.textContent = 'Please enter a valid email address.'; err.hidden = false; $('#em').classList.add('err'); $('#em').focus(); return; }
      $('#em').classList.remove('err');
      btn.disabled = true; btn.innerHTML = '<span class="fcv-spin"></span> Sending…';
      A.api({ action: 'sendlink', email: em }).then(function (r) {
        $('#slmsg').textContent = r.message; $('#slok').hidden = false;
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; })
        .then(function () { btn.disabled = false; btn.innerHTML = I.mail + ' Email me my link'; });
    });
  }

  /* --------------------------- profile menu ---------------------------- */
  function meMenu(d) {
    var r = d.request;
    return html`<div class="fcv-me no-print"><button class="fcv-avatar" id="meBtn" aria-haspopup="true" aria-expanded="false" aria-controls="meMenu"><b>${A.initials(r.name)}</b><span class="nm">${A.firstName(r.name)}</span></button>
      <div class="fcv-menu" id="meMenu" hidden><div class="who"><b>${r.name}</b>${r.email}</div>
        <a href="#/requests">${raw(I.list)} My requests</a><a href="tel:+13132932280">${raw(I.phone)} Call (313) 293-2280</a><button id="signOut">${raw(I.out)} Sign out</button></div></div>`;
  }
  function bindMenu() {
    var btn = $('#meBtn'), menu = $('#meMenu'); if (!btn) return;
    var close = function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.fcv-me')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); btn.focus(); } });
    $('#signOut').addEventListener('click', function () {
      forget(state.token); state.token = null; state.data = null; history.replaceState(null, '', 'track.html'); showSignIn();
    });
  }

  /* ------------------------- one request page ------------------------- */
  function priceBlock(r) {
    if (r.actualPrice != null) return html`<div class="fcv-kpi hero"><div class="k">Your quote</div><div class="v num">${A.dollars(r.actualPrice)}</div><div class="s">Confirmed by our team</div></div>`;
    if (r.estimateRange && r.estimateRange !== 'Site visit needed') return html`<div class="fcv-kpi"><div class="k">Rough online estimate</div><div class="v num">${r.estimateRange}</div><div class="s">Not a quote. We confirm your actual price after the site visit.</div></div>`;
    return html`<div class="fcv-kpi"><div class="k">Your quote</div><div class="v">Not ready yet</div><div class="s">We’ll confirm it after the site visit.</div></div>`;
  }
  function renderRequest() {
    var d = state.data, r = d.request, st = r.status, txt = T.STAGE_TEXT[st] || T.STAGE_TEXT['New'], closed = st === 'Declined';
    document.title = (r.title || 'My request') + ' - FCV Restoration & Construction';
    var name = A.firstName(r.name);
    var details = [['Name', r.name], ['Phone', ''], ['Email', r.email], ['Property', [r.address, r.city, r.zip].filter(Boolean).join(', ')],
      ['Property type', r.propertyType], ['Finish level', r.finishLevel], ['Hoping to start', r.timeline], ['Insurance claim', r.insuranceClaim], ['Your notes', r.customerNotes]]
      .filter(function (x) { return x[1]; });
    var body = html`<div class="fcv-stack" style="--gap:24px">
      <section class="fcv-card edge">
        <div class="fcv-row between wrap" style="align-items:flex-start;gap:24px">
          <div style="max-width:58ch"><span class="fcv-eyebrow">Current status</span><h2 class="fcv-h2" style="margin-top:12px">${txt[0]}</h2><p class="muted" style="margin:10px 0 0">${txt[1]}</p></div>
          <div class="fcv-grid c2" style="flex:1;min-width:min(100%,340px);max-width:520px">${priceBlock(r)}
            <div class="fcv-kpi"><div class="k">Work can start from</div><div class="v" style="font-size:34px">${r.workStartDate ? A.date(r.workStartDate) : 'To be confirmed'}</div><div class="s">${r.workStartDate ? 'Subject to permits and materials' : 'We’ll let you know here and by phone'}</div></div></div>
        </div>
        ${closed ? '' : html`<div style="margin-top:38px">${T.stepper(st)}</div>`}
        ${r.message ? html`<div class="fcv-callout" style="margin-top:28px">${raw(I.mail)}<p><b>A note from FCV</b><br>${r.message}</p></div>` : ''}
      </section>
      ${d.tracker ? T.view(d, state.tab, false) : ''}
      <div class="fcv-grid c2">
        ${(r.items.length || r.siteVisitItems.length) ? html`<section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:12px">The work you selected</h3>
          ${r.items.length ? html`<ul class="fcv-list">${r.items.map(function (x) { return html`<li>${x}</li>`; })}</ul>` : ''}
          ${r.siteVisitItems.length ? html`<h4 class="fcv-label" style="margin:22px 0 4px">Priced at the site visit</h4><ul class="fcv-list visit">${r.siteVisitItems.map(function (x) { return html`<li>${x}</li>`; })}</ul>` : ''}</section>` : ''}
        <section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:8px">Your details</h3><dl class="fcv-kv">${details.map(function (x) { return html`<dt>${x[0]}</dt><dd>${x[1]}</dd>`; })}</dl></section>
      </div>
      ${(!d.tracker && r.notes.length) ? html`<section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:8px">Notes</h3><ul class="fcv-list">${r.notes.map(function (x) { return html`<li>${x}</li>`; })}</ul></section>` : ''}
      <div class="fcv-callout">${raw(I.info)}<p><b>Prices can change.</b> Any online price is a rough estimate. Your final price is confirmed after our team sees the work in person.</p></div>
      <section class="fcv-card dark"><div class="fcv-row between wrap"><div><h3 class="fcv-h3" style="color:#fff">Questions? Talk to us.</h3><p class="muted" style="margin:8px 0 0">Reference <b style="color:#fff">${r.reference}</b>, quote it when you call or email.</p></div>
        <div class="fcv-row wrap"><a class="fcv-btn primary" href="tel:${d.company.phoneTel}">${raw(I.phone)} ${d.company.phone}</a><a class="fcv-btn" style="color:#fff;border-color:#fff" href="mailto:${d.company.email}?subject=${encodeURIComponent('My request ' + r.reference)}">${raw(I.mail)} Email us</a></div></div></section>
    </div>`;
    shell(body, heroBlock('Request ' + r.reference, r.title || 'Hello, ' + name + '.', 'Everything here is a read-only view, kept up to date by FCV Restoration & Construction.', meMenu(d)));
    bindMenu();
    if (d.tracker) T.bindTabs(app, onTab);
  }
  function onTab(tab, focus) {
    state.tab = tab; history.replaceState(null, '', location.pathname + location.search + '#/' + tab);
    var wrap = $('#panel').parentNode; wrap.outerHTML = T.view(state.data, tab, false).s;
    T.bindTabs(app, onTab); if (focus) { var b = $('#tab-' + tab); if (b) b.focus(); }
  }

  /* --------------------------- my requests --------------------------- */
  function showMine() {
    document.title = 'My requests - FCV Restoration & Construction';
    shell(html`<div class="fcv-stack"><div class="fcv-skel" style="height:200px"></div></div>`, heroBlock('Customer area', 'My requests', '', state.data ? meMenu(state.data) : ''));
    bindMenu();
    A.api({ action: 'mine', token: state.token }).then(function (r) {
      r.requests.forEach(function (x) { remember(x.token, x.reference, x.title, r.name); });
      var cards = r.requests.map(function (x) {
        var idx = T.STEPS.indexOf(x.status);
        return html`<a class="fcv-proj" href="track.html?k=${x.token}"><div class="fcv-row between wrap"><span class="fcv-code">${x.reference}</span>${A.chip(x.status)}</div>
          <h3>${x.title || x.summary || 'Your request'}</h3><div class="muted" style="font-size:14px">Submitted ${A.date(x.submittedAt)}</div>
          <div class="fcv-bar" aria-hidden="true" style="height:6px;margin-top:16px"><i style="width:${idx < 0 ? 0 : Math.round((idx + 1) / T.STEPS.length * 100)}%"></i></div>
          <div class="go"><span>Open</span>${raw(I.arrow.replace('<svg', '<svg style="width:16px;height:16px"'))}</div></a>`;
      });
      shell(html`<div class="fcv-stack"><div class="fcv-proj-grid">${cards}</div><div><a class="fcv-btn" href="pricing.html">${raw(I.plus)} Start a new request</a></div></div>`, heroBlock('Customer area', 'My requests', 'Every request made with ' + r.email + '.', state.data ? meMenu(state.data) : ''));
      bindMenu();
    }).catch(function (e) { shell(html`<div class="fcv-callout bad">${raw(I.alert)}<p>${e.message}</p></div>`); });
  }

  /* ------------------------------ loading ------------------------------ */
  function load(token) {
    state.token = token;
    shell(html`<div class="fcv-stack"><div class="fcv-skel" style="height:220px"></div><div class="fcv-skel" style="height:300px"></div></div>`, heroBlock('Customer area', 'Loading…', ''));
    A.api({ action: 'track', token: token }).then(function (d) {
      state.data = d; remember(token, d.request.reference, d.request.title, d.request.name);
      var h = hashRoute(); if (T.TABS.some(function (x) { return x[0] === h; })) state.tab = h;
      if (h === 'requests') showMine(); else renderRequest();
    }).catch(function (e) {
      if (e.code === 'not_found') { forget(token); showSignIn('We couldn’t find that request. The link may be incomplete. You can have it emailed to you again below.'); }
      else if (e.code === 'not_configured') shell(html`<div class="fcv-callout bad">${raw(I.alert)}<p><b>Not connected yet.</b> ${e.message}</p></div>`);
      else shell(html`<div class="fcv-callout bad">${raw(I.alert)}<p>${e.message} <button class="fcv-link" id="retry">Try again</button></p></div>`, heroBlock('Customer area', 'Track my request', ''));
      var rb = $('#retry'); if (rb) rb.addEventListener('click', function () { load(token); });
    });
  }

  window.addEventListener('hashchange', function () {
    if (!state.data) return;
    var h = hashRoute();
    if (h === 'requests') showMine();
    else if (T.TABS.some(function (x) { return x[0] === h; })) { state.tab = h; renderRequest(); }
    else renderRequest();
  });

  var t = qsToken() || (saved()[0] && saved()[0].token);
  if (t) load(t); else showSignIn();
})();
