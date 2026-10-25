/* admin.html: the team's page. Sign in with the admin password, then check and edit everything.
   Every change is saved straight into the Google Sheet. */
(function () {
  'use strict';
  var A = window.FCVApp, T = window.FCVTracker, html = A.html, raw = A.raw, I = A.icons, $ = A.$, $$ = A.$$;
  var app = document.getElementById('app');
  var S = { token: null, list: null, statuses: [], cur: null, dirty: {}, dirtyKind: null, route: null };

  /* ------------------------- what can be edited ------------------------- */
  var REQ_SECTIONS = [
    { title: 'Status & price', fields: [
      { k: 'Quote Status', label: 'Status', type: 'status' },
      { k: 'Actual Price', label: 'Actual price ($)', type: 'price', hint: 'The customer sees this once the quote is sent.' },
      { k: 'Work Start Date', label: 'Work can start from', type: 'date' },
      { k: 'Show Tracker', label: 'Show the project tracker to the customer now', type: 'check', full: true, hint: 'It also appears by itself when the status is Work in Progress or Completed.' },
      { k: 'Client Message', label: 'Message to the customer', type: 'textarea', full: true, hint: 'Shown on the customer’s page as “A note from FCV”.' }] },
    { title: 'Project', fields: [
      { k: 'Project Title', label: 'Project title', type: 'text', full: true },
      { k: 'Phase Label', label: 'Phase', type: 'text' },
      { k: 'Lender Status', label: 'Lender status', type: 'text' },
      { k: 'Estimate Source', label: 'Estimate source', type: 'text', full: true },
      { k: 'Project Notes', label: 'Project notes (shown to the customer)', type: 'chips', full: true, addLabel: 'Add new note', empty: 'No notes yet.' }] },
    { title: 'What the customer asked for', fields: [
      { k: 'Selected Items', label: 'Selected work', type: 'chips', full: true, addLabel: 'Add new item', empty: 'No items yet.' },
      { k: 'Site-Visit Items', label: 'Priced at the site visit', type: 'chips', full: true, addLabel: 'Add new item', empty: 'None.' },
      { k: 'Notes', label: 'Customer’s notes', type: 'textarea', full: true }] },
    { title: 'Customer & property', fields: [
      { k: 'Name', label: 'Name', type: 'text' }, { k: 'Phone', label: 'Phone', type: 'text' }, { k: 'Email', label: 'Email', type: 'text' },
      { k: 'Best Time to Reach', label: 'Best time to reach', type: 'text' }, { k: 'Property Address', label: 'Property address', type: 'text', full: true },
      { k: 'City', label: 'City', type: 'text' }, { k: 'ZIP', label: 'ZIP', type: 'text' }, { k: 'Property Type', label: 'Property type', type: 'text' },
      { k: 'Finish Level', label: 'Finish level', type: 'text' }, { k: 'Start Timeline', label: 'Hoping to start', type: 'text' }, { k: 'Insurance Claim', label: 'Insurance claim', type: 'text' }] },
    { title: 'Internal (customers never see this)', fields: [{ k: 'Internal Notes', label: 'Internal notes', type: 'textarea', full: true }] }
  ];
  var CONTACT_SECTIONS = [
    { title: 'Status', fields: [{ k: 'Quote Status', label: 'Status', type: 'status' }, { k: 'Internal Notes', label: 'Internal notes (customers never see this)', type: 'textarea', full: true }] },
    { title: 'Contact details', fields: [{ k: 'Name', label: 'Name', type: 'text' }, { k: 'Phone', label: 'Phone', type: 'text' }, { k: 'Email', label: 'Email', type: 'text' }, { k: 'Subject', label: 'Subject', type: 'text' }] }
  ];
  var REC = {
    budget: { label: 'budget line', fields: [
      { k: 'code', label: 'Item code', type: 'text' }, { k: 'category', label: 'Material / work category', type: 'text', req: 1, full: 1 },
      { k: 'quantity', label: 'Quantity', type: 'number', req: 1 }, { k: 'unit', label: 'Unit (sq ft, sheet, allowance…)', type: 'text' },
      { k: 'unitPrice', label: 'Unit price ($)', type: 'price', req: 1 }, { k: 'waste', label: 'Waste allowance (%)', type: 'number' },
      { k: 'basis', label: 'Estimation basis', type: 'text', full: 1 }] },
    expenses: { label: 'expense', fields: [
      { k: 'date', label: 'Purchase date', type: 'date', req: 1 }, { k: 'amount', label: 'Amount paid ($)', type: 'price', req: 1 },
      { k: 'vendor', label: 'Vendor', type: 'text', req: 1 }, { k: 'category', label: 'Budget category', type: 'text' },
      { k: 'description', label: 'What was purchased', type: 'text', req: 1, full: 1 }, { k: 'receipt', label: 'Receipt link (Google Drive, Dropbox…)', type: 'text', full: 1 },
      { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }] },
    supplements: { label: 'supplement', fields: [
      { k: 'status', label: 'Status', type: 'enum', values: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Withdrawn'], req: 1 }, { k: 'amount', label: 'Amount requested ($)', type: 'price', req: 1 },
      { k: 'scope', label: 'Scope / reason', type: 'text', req: 1, full: 1 }, { k: 'vendor', label: 'Vendor / trade', type: 'text' }, { k: 'date', label: 'Date submitted', type: 'date' },
      { k: 'approvedOn', label: 'Approval date', type: 'date', when: function (v) { return v.status === 'Approved'; }, hint: 'Leave empty to use today.' },
      { k: 'proof', label: 'Proof of approval (who approved it, where the signed copy is)', type: 'textarea', full: 1, when: function (v) { return v.status === 'Approved'; } },
      { k: 'support', label: 'Supporting link', type: 'text', full: 1 }, { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }] },
    draws: { label: 'draw request', fields: [
      { k: 'status', label: 'Status', type: 'enum', values: ['Proposed - not submitted', 'Submitted', 'Approved', 'Partially funded', 'Funded', 'Rejected'], req: 1 },
      { k: 'requested', label: 'Amount requested ($)', type: 'price', req: 1 }, { k: 'purpose', label: 'Purpose / phase', type: 'text', req: 1, full: 1 },
      { k: 'date', label: 'Date submitted', type: 'date', when: function (v) { return v.status !== 'Proposed - not submitted'; } },
      { k: 'approved', label: 'Amount approved ($)', type: 'price', when: function (v) { return ['Approved', 'Partially funded', 'Funded'].indexOf(v.status) !== -1; } },
      { k: 'disbursed', label: 'Amount disbursed ($)', type: 'price', when: function (v) { return ['Partially funded', 'Funded'].indexOf(v.status) !== -1; }, hint: 'Money actually paid out.' },
      { k: 'notes', label: 'Notes / lender reference', type: 'textarea', full: 1 }] },
    remaining: { label: 'remaining-amount item', fields: [
      { k: 'category', label: 'Category / trade', type: 'text', req: 1, full: 1 }, { k: 'amount', label: 'Amount ($)', type: 'price', req: 1 }, { k: 'note', label: 'Note', type: 'text', full: 1 }] }
  };

  /* ------------------------------ helpers ------------------------------ */
  var uid = 0;
  function fieldHtml(f, value, prefix) {
    var id = prefix + (++uid), v = value == null ? '' : value, err = '<p class="fcv-err" data-err="' + A.esc(f.k) + '" hidden></p>';
    var hint = f.hint ? '<p class="hint">' + A.esc(f.hint) + '</p>' : '';
    var label = '<label for="' + id + '">' + A.esc(f.label) + (f.req ? ' *' : '') + '</label>';
    var cls = 'fcv-field' + (f.full ? ' full' : ''), ctl;
    if (f.type === 'check') {
      return '<div class="' + cls + '"><label class="fcv-check"><input type="checkbox" id="' + id + '" data-k="' + A.esc(f.k) + '"' + (String(v).toLowerCase() === 'yes' ? ' checked' : '') + '> ' + A.esc(f.label) + '</label>' + hint + '</div>';
    }
    if (f.type === 'chips') return '<div class="' + cls + '"><span class="fcv-label" id="' + id + '">' + A.esc(f.label) + '</span><div data-chips="' + A.esc(f.k) + '" aria-labelledby="' + id + '"></div>' + hint + '</div>';
    if (f.type === 'textarea') ctl = '<textarea class="fcv-textarea" id="' + id + '" data-k="' + A.esc(f.k) + '">' + A.esc(v) + '</textarea>';
    else if (f.type === 'status' || f.type === 'enum') {
      var opts = f.type === 'status' ? S.statuses : f.values;
      ctl = '<select class="fcv-select" id="' + id + '" data-k="' + A.esc(f.k) + '">' + (opts.indexOf(v) === -1 && v !== '' ? '<option>' + A.esc(v) + '</option>' : '') + opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + A.esc(o) + '</option>'; }).join('') + '</select>';
    } else {
      ctl = '<input class="fcv-input" id="' + id + '" data-k="' + A.esc(f.k) + '" ' + (f.type === 'date' ? 'type="date"' : f.type === 'price' || f.type === 'number' ? 'type="text" inputmode="decimal"' : 'type="text"') + ' value="' + A.esc(v) + '" autocomplete="off">';
    }
    return '<div class="' + cls + '" data-wrap="' + A.esc(f.k) + '">' + label + ctl + hint + err + '</div>';
  }
  function showErrors(root, fields) {
    $$('[data-err]', root).forEach(function (p) { p.hidden = true; });
    $$('.err', root).forEach(function (x) { x.classList.remove('err'); });
    var first = null;
    Object.keys(fields || {}).forEach(function (k) {
      var p = $('[data-err="' + k + '"]', root), inp = $('[data-k="' + k + '"]', root);
      if (p) { p.textContent = fields[k]; p.hidden = false; } if (inp) { inp.classList.add('err'); first = first || inp; }
    });
    if (first) first.focus();
  }
  function handleErr(e) {
    if (e.code === 'unauthorized') { signOut('Your session ended. Please sign in again.'); return true; }
    return false;
  }
  function stamp(r) { return A.date(r['Submitted At']); }
  function route() { return (location.hash || '').replace(/^#\/?/, '').split('/'); }
  function go(h) { location.hash = h; }
  function norm(k, v) { return k === 'Show Tracker' ? (String(v).toLowerCase() === 'yes' ? 'Yes' : 'No') : (['Selected Items', 'Site-Visit Items', 'Project Notes'].indexOf(k) !== -1 ? A.splitList(v).join(', ') : String(v == null ? '' : v).trim()); }

  /* --------------------------- sign in / out --------------------------- */
  function signOut(note) {
    A.store.del('fcv_admin', true); S.token = null; S.list = null; S.cur = null; S.dirty = {};
    loginScreen(note);
  }
  function loginScreen(note) {
    document.title = 'Admin sign in - FCV Restoration & Construction';
    A.mount(app, html`<div class="fcv-wrap"><div class="fcv-hero"><div><span class="fcv-eyebrow">Team area</span><h1 class="fcv-title">Admin</h1><p class="fcv-lead">Sign in to see every request and message, update statuses and prices, and keep each project’s tracker up to date.</p></div></div>
      <div class="fcv-signin fcv-stack">
        ${note ? html`<div class="fcv-callout bad">${raw(I.alert)}<p>${note}</p></div>` : ''}
        <section class="fcv-card edge"><h2 class="fcv-h2">Sign in</h2>
          <form id="lf" class="fcv-stack" style="--gap:16px;margin-top:18px" novalidate>
            <div class="fcv-field"><label for="pw">Admin password</label><input class="fcv-input" id="pw" type="password" autocomplete="current-password" required></div>
            <p class="fcv-err" id="lferr" role="alert" hidden></p>
            <button class="fcv-btn primary" id="lfbtn" type="submit">${raw(I.lock)} Sign in</button>
          </form></section></div></div>`);
    $('#pw').focus();
    $('#lf').addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = $('#pw').value, btn = $('#lfbtn'), err = $('#lferr'); err.hidden = true;
      if (!pw) { err.textContent = 'Please enter the password.'; err.hidden = false; return; }
      btn.disabled = true; btn.innerHTML = '<span class="fcv-spin"></span> Checking…';
      A.api({ action: 'login', password: pw }).then(function (r) { S.token = r.token; A.store.set('fcv_admin', r.token, true); start(); })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; $('#pw').select(); btn.disabled = false; btn.innerHTML = I.lock + ' Sign in'; });
    });
  }

  /* -------------------------------- lists -------------------------------- */
  function loadList(force) {
    if (S.list && !force) return Promise.resolve(S.list);
    return A.api({ action: 'list', token: S.token }).then(function (r) { S.list = r; S.statuses = r.statusOptions; return r; });
  }
  function topBar(active, extra) {
    var q = S.list ? S.list.quotes.length : '', c = S.list ? S.list.contacts.length : '';
    return html`<div class="fcv-hero"><div><span class="fcv-eyebrow">Team area</span><h1 class="fcv-title">Admin</h1></div>
      <div class="fcv-row wrap no-print">
        <div class="fcv-seg" role="group" aria-label="View"><button aria-pressed="${String(active === 'requests')}" data-nav="">Requests ${q !== '' ? '(' + q + ')' : ''}</button><button aria-pressed="${String(active === 'messages')}" data-nav="messages">Messages ${c !== '' ? '(' + c + ')' : ''}</button></div>
        <button class="fcv-btn sm" id="refresh">${raw(I.refresh)} Refresh</button><button class="fcv-btn sm primary" id="addReq">${raw(I.plus)} Add request</button><button class="fcv-btn sm" id="out">${raw(I.out)} Sign out</button></div></div>`;
  }
  function bindTop() {
    $$('[data-nav]').forEach(function (b) { b.addEventListener('click', function () { go('/' + b.dataset.nav); }); });
    $('#refresh').addEventListener('click', function () { S.list = null; render(); A.toast('Refreshed from the sheet'); });
    $('#addReq').addEventListener('click', addRequestModal);
    $('#out').addEventListener('click', function () { signOut(); });
  }
  function listScreen(kind) {
    document.title = 'Admin - FCV Restoration & Construction';
    A.mount(app, html`<div class="fcv-wrap">${topBar(kind)}<div class="fcv-stack"><div class="fcv-skel" style="height:90px"></div><div class="fcv-skel" style="height:300px"></div></div></div>`);
    bindTop();
    loadList().then(function () {
      var rows = kind === 'requests' ? S.list.quotes : S.list.contacts;
      rows = rows.slice().sort(function (a, b) { return String(b['Submitted At']).localeCompare(String(a['Submitted At'])); });
      S.f = S.f || {}; var fl = S.f[kind] = S.f[kind] || { q: '', st: '' }, q = fl.q, st = fl.st;
      var draw = function () {
        var f = rows.filter(function (r) {
          if (st && r['Quote Status'] !== st) return false;
          var hay = [r['Reference'], r['Name'], r['Email'], r['Phone'], r['Property Address'], r['City'], r['Project Title'], r['Subject'], r['Selected Items']].join(' ').toLowerCase();
          return !q || q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
        });
        var base = kind === 'requests' ? '#/r/' : '#/c/';
        $('#rows').innerHTML = f.length ? '<table class="fcv-t"><thead><tr><th>Reference</th><th>' + (kind === 'requests' ? 'Customer' : 'From') + '</th><th>' + (kind === 'requests' ? 'Project / work' : 'Subject') + '</th><th>Status</th>' + (kind === 'requests' ? '<th class="r">Price</th>' : '') + '<th>Received</th></tr></thead><tbody>' +
          f.map(function (r) {
            return html`<tr class="click" tabindex="0" data-href="${base + encodeURIComponent(r['Reference'])}"><td><span class="fcv-code">${r['Reference']}</span></td><td><b>${r['Name']}</b><span class="sub">${r['Email']}${r['Phone'] ? ' · ' + r['Phone'] : ''}</span></td>
              <td>${kind === 'requests' ? (r['Project Title'] || A.splitList(r['Selected Items']).slice(0, 2).join(', ') || '—') : r['Subject']}${kind === 'requests' && r['City'] ? html`<span class="sub">${r['City']}</span>` : ''}</td><td>${A.chip(r['Quote Status'] || 'New')}</td>
              ${kind === 'requests' ? html`<td class="r num">${r['Actual Price'] !== '' && r['Actual Price'] != null ? A.dollars(r['Actual Price']) : '—'}</td>` : ''}<td class="num" style="white-space:nowrap">${stamp(r)}</td></tr>`.s;
          }).join('') + '</tbody></table>' : html`<div class="fcv-empty">${raw(I.search)}<b>${rows.length ? 'Nothing matches that search' : (kind === 'requests' ? 'No requests yet' : 'No messages yet')}</b><p style="margin:0">${rows.length ? 'Try a different word or clear the status filter.' : 'New ones from the website forms will show up here and in the sheet.'}</p></div>`.s;
        $('#cnt').textContent = f.length + ' of ' + rows.length;
        $$('[data-href]').forEach(function (tr) {
          tr.addEventListener('click', function () { location.hash = tr.dataset.href.slice(1); });
          tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') location.hash = tr.dataset.href.slice(1); });
        });
      };
      A.mount(app, html`<div class="fcv-wrap">${topBar(kind)}<section class="fcv-card flush"><div class="fcv-card-head"><div class="fcv-bar-tools">
        <input class="fcv-input" id="q" type="search" placeholder="Search name, email, reference, address…" aria-label="Search" value="${q}">
        <select class="fcv-select" id="st" aria-label="Filter by status"><option value="">All statuses</option>${S.statuses.map(function (s) { return html`<option ${s === st ? raw('selected') : ''}>${s}</option>`; })}</select></div>
        <span class="muted" id="cnt"></span></div><div class="fcv-table-wrap" id="rows"></div></section></div>`);
      bindTop(); draw();
      $('#q').addEventListener('input', function (e) { q = fl.q = e.target.value; draw(); });
      $('#st').addEventListener('change', function (e) { st = fl.st = e.target.value; draw(); });
    }).catch(function (e) {
      if (handleErr(e)) return;
      A.mount(app, html`<div class="fcv-wrap">${topBar(kind)}<div class="fcv-callout bad">${raw(I.alert)}<p>${e.message} <button class="fcv-link" id="retry">Try again</button></p></div></div>`);
      bindTop(); $('#retry').addEventListener('click', function () { render(); });
    });
  }

  /* ------------------------ add a request by hand ------------------------ */
  function addRequestModal() {
    var defs = [{ k: 'Name', label: 'Customer name', type: 'text', req: 1, full: 1 }, { k: 'Email', label: 'Email', type: 'text' }, { k: 'Phone', label: 'Phone', type: 'text' },
      { k: 'Property Address', label: 'Property address', type: 'text', full: 1 }, { k: 'Project Title', label: 'Project title', type: 'text', full: 1 },
      { k: 'Quote Status', label: 'Status', type: 'status' }, { k: 'Actual Price', label: 'Actual price ($)', type: 'price' },
      { k: 'Reference', label: 'Reference (leave empty to number it automatically)', type: 'text', full: 1 },
      { k: 'Selected Items', label: 'Selected work', type: 'chips', full: 1, addLabel: 'Add new item', empty: 'No items yet.' }];
    var vals = {}, m = A.modal({ title: 'Add a request', body: raw('<div class="fcv-form-grid">' + defs.map(function (f) { return fieldHtml(f, f.k === 'Quote Status' ? S.statuses[0] : '', 'n'); }).join('') + '</div>'),
      actions: [{ label: 'Cancel', onClick: function (x) { x.close(); } }, { label: 'Add request', kind: 'primary', onClick: save }] });
    $$('[data-chips]', m.body).forEach(function (el) { A.chipList(el, { value: '', addLabel: 'Add new item', empty: 'No items yet.', onChange: function (v) { vals[el.dataset.chips] = v; } }); });
    function save(x, btn) {
      var f = {}; $$('[data-k]', m.body).forEach(function (el) { f[el.dataset.k] = el.type === 'checkbox' ? (el.checked ? 'Yes' : 'No') : el.value.trim(); });
      Object.keys(vals).forEach(function (k) { f[k] = vals[k]; });
      btn.disabled = true;
      A.api({ action: 'new_request', token: S.token, fields: f }).then(function (r) { m.close(); S.list = null; A.toast('Added ' + r.ref, 'ok'); go('/r/' + encodeURIComponent(r.ref)); })
        .catch(function (e) { btn.disabled = false; if (handleErr(e)) return; showErrors(m.body, e.fields); A.toast(e.message, 'bad'); });
    }
  }

  /* ---------------------------- detail editors ---------------------------- */
  function tabsForRequest() { return [['edit', 'Details']].concat(T.TABS).concat([['history', 'History']]); }
  function trackLike(q, tracker) {
    var price = q['Actual Price'];
    return { request: { reference: q['Reference'], name: q['Name'], email: q['Email'], title: q['Project Title'], phaseLabel: q['Phase Label'], lenderStatus: q['Lender Status'], estimateSource: q['Estimate Source'],
      notes: A.splitList(q['Project Notes']), address: q['Property Address'], city: q['City'], zip: q['ZIP'], actualPrice: price === '' || price == null ? null : Number(price) },
      tracker: tracker, company: { name: 'FCV Restoration & Construction' } };
  }
  function customerLink(d) {
    if (d.trackUrl) return d.trackUrl;
    if (!d.trackToken) return '';
    return new URL('track.html?k=' + d.trackToken, location.href.replace(/[#?].*$/, '')).href;
  }

  function requestScreen(ref, tab) {
    document.title = ref + ' - Admin';
    A.mount(app, html`<div class="fcv-wrap"><div class="fcv-stack"><div class="fcv-skel" style="height:120px"></div><div class="fcv-skel" style="height:360px"></div></div></div>`);
    Promise.all([A.api({ action: 'get', token: S.token, ref: ref }), loadList()]).then(function (res) {
      S.cur = { kind: 'request', ref: ref, data: res[0], tab: tab || 'edit' }; S.dirty = {}; S.dirtyKind = 'request'; paintRequest();
    }).catch(function (e) { if (handleErr(e)) return; A.mount(app, html`<div class="fcv-wrap"><a class="fcv-link" href="#/">${raw(I.back)} All requests</a><div class="fcv-callout bad" style="margin-top:18px">${raw(I.alert)}<p>${e.message}</p></div></div>`); });
  }

  function paintRequest() {
    var c = S.cur, d = c.data, q = d.quote, tab = c.tab, link = customerLink(d), tabs = tabsForRequest();
    var visible = String(q['Show Tracker']).toLowerCase() === 'yes' || ['Work in Progress', 'Completed'].indexOf(q['Quote Status']) !== -1;
    var head = html`<div class="fcv-hero"><div><a class="fcv-link no-print" href="#/" style="font-size:14px">${raw(I.back.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"'))} All requests</a>
        <div class="fcv-row wrap" style="margin-top:16px;gap:14px"><span class="fcv-code">${q['Reference']}</span>${A.chip(q['Quote Status'] || 'New')}<span class="muted">Received ${stamp(q)}</span></div>
        <h1 class="fcv-title" style="font-size:clamp(40px,5.5vw,72px)">${q['Name']}</h1><p class="fcv-lead" style="margin-top:10px">${[q['Project Title'], q['Property Address'], q['City']].filter(Boolean).join(' · ') || q['Email']}</p></div>
      <div class="fcv-row wrap no-print">${link ? html`<a class="fcv-btn sm" href="${link}" target="_blank" rel="noopener">${raw(I.eye)} See what the customer sees</a><button class="fcv-btn sm" id="copyLink">${raw(I.copy)} Copy customer link</button>` : ''}
        <a class="fcv-btn sm" href="tel:${String(q['Phone']).replace(/[^\d+]/g, '')}">${raw(I.phone)} Call</a><a class="fcv-btn sm" href="mailto:${q['Email']}">${raw(I.mail)} Email</a></div></div>`;
    var tabsBar = html`<div class="fcv-tabs no-print" role="tablist" aria-label="Request sections">${tabs.map(function (x) { return html`<button class="fcv-tab" role="tab" id="tab-${x[0]}" aria-selected="${String(x[0] === tab)}" data-tab="${x[0]}">${x[1]}</button>`; })}</div>`;
    var body;
    if (tab === 'edit') {
      body = html`<div class="fcv-stack" style="--gap:22px" id="editor">${REQ_SECTIONS.map(function (sec) {
        return html`<section class="fcv-section"><h3 class="fcv-h3">${sec.title}</h3><div class="fcv-form-grid">${raw(sec.fields.map(function (f) { return fieldHtml(f, f.type === 'chips' ? '' : q[f.k], 'f'); }).join(''))}</div></section>`; })}
        ${link ? html`<section class="fcv-section"><h3 class="fcv-h3">Customer’s private link</h3><p class="muted" style="margin:0 0 14px">Anyone with this link can see this request, so only send it to the customer.</p><div class="fcv-linkbox"><input class="fcv-input" readonly value="${link}" aria-label="Customer link" id="linkInput"></div></section>` : ''}
        <div class="fcv-savebar" id="savebar"><span id="saveMsg">No changes yet</span><span class="fcv-row"><button class="fcv-btn sm" id="discard" disabled style="color:#fff;border-color:#fff">Discard</button><button class="fcv-btn sm primary" id="save" disabled>Save changes</button></span></div></div>`;
    } else if (tab === 'history') {
      body = html`<section class="fcv-card flush"><div class="fcv-card-head"><h3 class="fcv-h3">Change history</h3><span class="muted">Everything changed in the admin panel for this request.</span></div><div class="fcv-table-wrap" id="hist"><div class="fcv-empty"><span class="fcv-spin"></span></div></div></section>`;
    } else {
      body = html`<div class="fcv-stack" style="--gap:18px">${visible ? '' : html`<div class="fcv-callout">${raw(I.eye)}<p><b>The customer can’t see this tracker yet.</b> It appears for them when the status is Work in Progress or Completed, or when you tick “Show the project tracker to the customer now” on the Details tab.</p></div>`}
        ${q['Actual Price'] === '' ? html`<div class="fcv-callout bad">${raw(I.alert)}<p><b>No actual price is set.</b> Enter the price on the Details tab so the budget totals can be worked out.</p></div>` : ''}
        <div id="tview">${T.view(trackLike(q, d.tracker), tab, true)}</div></div>`;
    }
    A.mount(app, html`<div class="fcv-wrap">${head}${tabsBar}<div style="margin-top:26px">${body}</div></div>`);

    $$('.fcv-tabs [data-tab]').forEach(function (b) { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });
    var cl = $('#copyLink'); if (cl) cl.addEventListener('click', function () { copyText(link); });
    if (tab === 'edit') bindEditor(REQ_SECTIONS, q, 'request');
    else if (tab === 'history') loadHistory(q['Reference']);
    else bindTracker();
  }
  function copyText(t) {
    var done = function () { A.toast('Link copied', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { fallback(); }); else fallback();
    function fallback() { var i = $('#linkInput') || document.createElement('input'); i.value = t; if (!i.parentNode) document.body.appendChild(i); i.select(); try { document.execCommand('copy'); done(); } catch (e) { A.toast('Copy the link from the box below', 'bad'); } if (i.id !== 'linkInput') i.remove(); }
  }
  function switchTab(tab) {
    guardDirty().then(function (ok) { if (!ok) return; S.cur.tab = tab; S.dirty = {}; history.replaceState(null, '', '#/r/' + encodeURIComponent(S.cur.ref) + '/' + tab); paintRequest(); window.scrollTo({ top: 0 }); });
  }

  /* ---- the Details editor: tracks what changed, saves only that ---- */
  function bindEditor(sections, rec, kind) {
    var root = $('#editor'), saveBtn = $('#save'), msg = $('#saveMsg'), discard = $('#discard');
    var defs = {}; sections.forEach(function (s) { s.fields.forEach(function (f) { defs[f.k] = f; }); });
    function mark(k, v) {
      var orig = f_orig(k);
      if (norm(k, v) === norm(k, orig)) delete S.dirty[k]; else S.dirty[k] = v;
      var n = Object.keys(S.dirty).length;
      saveBtn.disabled = discard.disabled = !n;
      msg.innerHTML = n ? '<span class="dot"></span>' + n + ' unsaved change' + (n > 1 ? 's' : '') : 'No changes yet';
    }
    function f_orig(k) { return rec[k] == null ? '' : rec[k]; }
    $$('[data-chips]', root).forEach(function (el) {
      var k = el.dataset.chips, f = defs[k];
      A.chipList(el, { value: rec[k], addLabel: f.addLabel, empty: f.empty, onChange: function (v) { mark(k, v); } });
    });
    root.addEventListener('input', function (e) { var el = e.target; if (el.dataset && el.dataset.k && el.type !== 'checkbox') mark(el.dataset.k, el.value); });
    root.addEventListener('change', function (e) { var el = e.target; if (el.dataset && el.dataset.k) mark(el.dataset.k, el.type === 'checkbox' ? (el.checked ? 'Yes' : 'No') : el.value); });
    discard.addEventListener('click', function () { S.dirty = {}; if (kind === 'request') paintRequest(); else paintContact(); });
    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true; saveBtn.innerHTML = '<span class="fcv-spin"></span> Saving…';
      A.api({ action: 'update', token: S.token, ref: rec['Reference'], row: rec._row, tab: kind === 'contact' ? 'contact' : 'quote', fields: S.dirty }).then(function (r) {
        Object.keys(r.record).forEach(function (k) { rec[k] = r.record[k]; });
        S.dirty = {}; S.list = null; A.toast('Saved to the Google Sheet', 'ok');
        if (kind === 'request') paintRequest(); else paintContact();
      }).catch(function (e) {
        saveBtn.disabled = false; saveBtn.innerHTML = 'Save changes';
        if (handleErr(e)) return; A.toast(e.message, 'bad');
      });
    });
  }
  function guardDirty() {
    if (!Object.keys(S.dirty).length) return Promise.resolve(true);
    return A.confirm('Discard unsaved changes?', 'You have changes that haven’t been saved to the sheet yet.', 'Discard changes', true).then(function (ok) { if (ok) S.dirty = {}; return ok; });
  }

  /* ---- history ---- */
  function loadHistory(ref) {
    A.api({ action: 'log', token: S.token, ref: ref }).then(function (r) {
      $('#hist').innerHTML = r.entries.length ? '<table class="fcv-t"><thead><tr><th>When</th><th>What</th><th>Details</th></tr></thead><tbody>' + r.entries.map(function (e) {
        return html`<tr><td class="num" style="white-space:nowrap">${e.time}</td><td><b>${e.what}</b></td><td class="muted">${e.details}</td></tr>`.s; }).join('') + '</tbody></table>'
        : html`<div class="fcv-empty">${raw(I.doc)}<b>No changes recorded yet</b><p style="margin:0">Edits made here will be listed with the date and time.</p></div>`.s;
    }).catch(function (e) { if (!handleErr(e)) $('#hist').innerHTML = html`<div class="fcv-empty"><b>Couldn’t load the history</b>${e.message}</div>`.s; });
  }

  /* ---- tracker tabs: add / edit / delete records ---- */
  function bindTracker() {
    var c = S.cur;
    var redraw = function () { $('#tview').innerHTML = T.view(trackLike(c.data.quote, c.data.tracker), c.tab, true).s; wire(); };
    function wire() {
      T.bindTabs($('#tview'), function (tab) { c.tab = tab; history.replaceState(null, '', '#/r/' + encodeURIComponent(c.ref) + '/' + tab); paintRequest(); });
      $$('#tview [data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var table = b.dataset.table, id = b.dataset.id;
          if (b.dataset.act === 'delete') return del(table, id);
          recordModal(table, b.dataset.act === 'edit' ? c.data.tracker[table].filter(function (x) { return x.id === id; })[0] : null);
        });
      });
    }
    function del(table, id) {
      A.confirm('Delete this ' + REC[table].label + '?', 'It will be removed from the sheet. The change is recorded in the history.', 'Delete', true).then(function (ok) {
        if (!ok) return;
        A.api({ action: 'rec_delete', token: S.token, ref: c.ref, table: table, id: id }).then(function (r) { c.data.tracker = r.tracker; A.toast('Deleted', 'ok'); redraw(); })
          .catch(function (e) { if (!handleErr(e)) A.toast(e.message, 'bad'); });
      });
    }
    wire();
  }
  function recordModal(table, rec) {
    var c = S.cur, spec = REC[table], vals = {};
    spec.fields.forEach(function (f) { vals[f.k] = rec && rec[f.k] != null ? rec[f.k] : (f.type === 'enum' ? f.values[0] : ''); });
    var m = A.modal({ title: (rec ? 'Edit ' : 'Add ') + spec.label, body: raw('<div class="fcv-form-grid" id="rf"></div>'),
      actions: [{ label: 'Cancel', onClick: function (x) { x.close(); } }, { label: rec ? 'Save changes' : 'Add', kind: 'primary', onClick: save }] });
    function paint() {
      var keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
      $('#rf', m.body).innerHTML = spec.fields.filter(function (f) { return !f.when || f.when(vals); }).map(function (f) { return fieldHtml(f, vals[f.k], 'r'); }).join('');
      if (keep) { var el = $('[data-k="' + keep + '"]', m.body); if (el && el.type !== 'select-one') el.focus(); }
    }
    paint();
    m.body.addEventListener('input', function (e) { if (e.target.dataset.k) vals[e.target.dataset.k] = e.target.value; });
    m.body.addEventListener('change', function (e) { if (e.target.dataset.k) { vals[e.target.dataset.k] = e.target.value; if (e.target.type === 'select-one') { paint(); var s = $('[data-k="' + e.target.dataset.k + '"]', m.body); if (s) s.focus(); } } });
    function save(x, btn) {
      var f = {}; spec.fields.forEach(function (fd) { f[fd.k] = (!fd.when || fd.when(vals)) ? String(vals[fd.k] == null ? '' : vals[fd.k]).trim() : ''; });
      btn.disabled = true;
      A.api({ action: 'rec_save', token: S.token, ref: c.ref, table: table, id: rec ? rec.id : '', fields: f }).then(function (r) {
        c.data.tracker = r.tracker; m.close(); A.toast(rec ? 'Saved' : 'Added', 'ok');
        $('#tview').innerHTML = T.view(trackLike(c.data.quote, c.data.tracker), c.tab, true).s; paintRequest();
      }).catch(function (e) { btn.disabled = false; if (handleErr(e)) return; showErrors(m.body, e.fields); A.toast(e.message, 'bad'); });
    }
  }

  /* ---- a contact message ---- */
  function contactScreen(ref) {
    document.title = ref + ' - Admin';
    loadList().then(function () {
      var rec = S.list.contacts.filter(function (r) { return r['Reference'] === ref; })[0];
      if (!rec) throw new Error('That message was not found. It may have been deleted from the sheet.');
      S.cur = { kind: 'contact', ref: ref, rec: rec }; S.dirty = {}; S.dirtyKind = 'contact'; paintContact();
    }).catch(function (e) { if (handleErr(e)) return; A.mount(app, html`<div class="fcv-wrap"><a class="fcv-link" href="#/messages">${raw(I.back)} All messages</a><div class="fcv-callout bad" style="margin-top:18px">${raw(I.alert)}<p>${e.message}</p></div></div>`); });
  }
  function paintContact() {
    var rec = S.cur.rec;
    A.mount(app, html`<div class="fcv-wrap"><div class="fcv-hero"><div><a class="fcv-link" href="#/messages" style="font-size:14px">${raw(I.back.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"'))} All messages</a>
      <div class="fcv-row wrap" style="margin-top:16px;gap:14px"><span class="fcv-code">${rec['Reference']}</span>${A.chip(rec['Quote Status'] || 'New')}<span class="muted">Received ${stamp(rec)}</span></div>
      <h1 class="fcv-title" style="font-size:clamp(40px,5.5vw,72px)">${rec['Name']}</h1><p class="fcv-lead" style="margin-top:10px">${rec['Subject']}</p></div>
      <div class="fcv-row wrap"><a class="fcv-btn sm" href="tel:${String(rec['Phone']).replace(/[^\d+]/g, '')}">${raw(I.phone)} Call</a><a class="fcv-btn sm" href="mailto:${rec['Email']}">${raw(I.mail)} Reply by email</a></div></div>
      <div class="fcv-stack" style="--gap:22px" id="editor"><section class="fcv-section"><h3 class="fcv-h3">Their message</h3><p style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere">${rec['Message'] || '(no message entered)'}</p></section>
        ${CONTACT_SECTIONS.map(function (sec) { return html`<section class="fcv-section"><h3 class="fcv-h3">${sec.title}</h3><div class="fcv-form-grid">${raw(sec.fields.map(function (f) { return fieldHtml(f, rec[f.k], 'c'); }).join(''))}</div></section>`; })}
        <div class="fcv-savebar"><span id="saveMsg">No changes yet</span><span class="fcv-row"><button class="fcv-btn sm" id="discard" disabled style="color:#fff;border-color:#fff">Discard</button><button class="fcv-btn sm primary" id="save" disabled>Save changes</button></span></div></div></div>`);
    bindEditor(CONTACT_SECTIONS, rec, 'contact');
  }

  /* -------------------------------- routing -------------------------------- */
  function render() {
    var r = route(), a = r[0] || '';
    if (a === 'r' && r[1]) return requestScreen(decodeURIComponent(r[1]), r[2] || 'edit');
    if (a === 'c' && r[1]) return contactScreen(decodeURIComponent(r[1]));
    if (a === 'messages') return listScreen('messages');
    return listScreen('requests');
  }
  var lastHash = location.hash;
  window.addEventListener('hashchange', function () {
    if (!S.token) { lastHash = location.hash; return; }
    if (Object.keys(S.dirty).length) {
      var target = location.hash; history.replaceState(null, '', lastHash);
      A.confirm('Discard unsaved changes?', 'You have changes that haven’t been saved to the sheet yet.', 'Discard changes', true).then(function (ok) { if (ok) { S.dirty = {}; location.hash = target; } });
      return;
    }
    lastHash = location.hash; render();
  });
  window.addEventListener('beforeunload', function (e) { if (Object.keys(S.dirty).length) { e.preventDefault(); e.returnValue = ''; } });

  function start() { lastHash = location.hash; render(); }
  S.token = A.store.get('fcv_admin', true);
  if (!A.endpointOk()) {
    A.mount(app, html`<div class="fcv-wrap"><div class="fcv-callout bad">${raw(I.alert)}<p><b>Not connected yet.</b> Paste your Apps Script web app address into <b>fcv-config.js</b> (see README.md, step 6).</p></div></div>`);
  } else if (S.token) {
    A.api({ action: 'list', token: S.token }).then(function (r) { S.list = r; S.statuses = r.statusOptions; start(); }).catch(function () { A.store.del('fcv_admin', true); S.token = null; loginScreen(); });
  } else loginScreen();
})();
