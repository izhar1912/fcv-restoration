/* FCV shared helpers for track.html and admin.html. No libraries, no build step. */
(function () {
  'use strict';
  var A = (window.FCVApp = {});

  /* ---- safe HTML templates: html`<b>${userText}</b>` escapes userText automatically ---- */
  function Safe(s) { this.s = s; }
  Safe.prototype.toString = function () { return this.s; };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function val(v) {
    if (v instanceof Safe) return v.s;
    if (Array.isArray(v)) return v.map(val).join('');
    if (v === false || v == null) return '';
    return esc(v);
  }
  A.html = function (strings) {
    var out = '', i;
    for (i = 0; i < strings.length; i++) { out += strings[i]; if (i < arguments.length - 1) out += val(arguments[i + 1]); }
    return new Safe(out);
  };
  A.raw = function (s) { return new Safe(s); };
  A.esc = esc;
  A.mount = function (el, safe) { el.innerHTML = safe instanceof Safe ? safe.s : String(safe); };
  A.$ = function (sel, root) { return (root || document).querySelector(sel); };
  A.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---- numbers and dates ---- */
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  A.cents = function (v) { return v == null || v === '' || isNaN(Number(v)) ? 0 : Math.round(Number(v) * 100); };
  A.money = function (cents) { return cents == null ? '—' : usd.format(cents / 100); };
  A.dollars = function (d) { return d == null || d === '' ? '—' : usd.format(Number(d)); };
  A.pct = function (x) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(2) + '%'; };
  A.qty = function (n) { return n == null ? '' : String(Number(n)); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  A.date = function (s) {                               // '2026-03-04' or '2026-03-04T10:00:00'
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : (s || '');
  };
  A.today = function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  A.firstName = function (n) { var f = String(n || '').trim().split(/\s+/)[0] || 'there'; return f.charAt(0).toUpperCase() + f.slice(1); };
  A.initials = function (n) { var p = String(n || '?').trim().split(/\s+/); return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };

  /* ---- a "list" is stored in one cell as: item one, item two (with, comma inside brackets), item three ---- */
  A.splitList = function (v) {
    var s = Array.isArray(v) ? v.join(',') : String(v == null ? '' : v), out = [], cur = '', depth = 0, i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (ch === '(' || ch === '[') depth++; else if ((ch === ')' || ch === ']') && depth > 0) depth--;
      if ((ch === ',' && depth === 0) || ch === ';' || ch === '\n') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  };

  /* ---- talking to the Google Sheet (Apps Script web app) ---- */
  A.endpointOk = function () { return /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(window.FCV_ENDPOINT || ''); };
  A.api = function (body) {
    if (!A.endpointOk()) {
      return Promise.reject(Object.assign(new Error('This page is not connected yet. Paste the Apps Script web app address into fcv-config.js.'), { code: 'not_configured' }));
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 45000) : null;
    return fetch(window.FCV_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.text(); }).then(function (t) {
      if (timer) clearTimeout(timer);
      var j; try { j = JSON.parse(t); } catch (e) { throw Object.assign(new Error('The server sent an unexpected answer. Please try again in a moment.'), { code: 'bad_response' }); }
      if (!j.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { code: j.code || 'error', fields: j.fields });
      return j;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw Object.assign(new Error(e && e.name === 'AbortError' ? 'That took too long. Please try again.' : 'We could not reach the server. Check your internet connection and try again.'), { code: 'network' });
    });
  };

  /* ---- little browser-storage helpers (never crash if storage is blocked) ---- */
  A.store = {
    get: function (k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set: function (k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} },
    del: function (k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch (e) {} }
  };

  /* ---- icons ---- */
  var I = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  A.icons = {
    check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), alert: I('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18.5v.01"/>'),
    info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'), edit: I('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>'),
    trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'), plus: I('<path d="M12 5v14M5 12h14"/>'),
    back: I('<path d="M15 5l-7 7 7 7"/>'), arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'), doc: I('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
    phone: I('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>'),
    mail: I('<rect x="3" y="5" width="18" height="14"/><path d="M3 7l9 6 9-6"/>'), out: I('<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>'),
    list: I('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'), copy: I('<rect x="9" y="9" width="11" height="11"/><path d="M5 15V5h10"/>'),
    eye: I('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), refresh: I('<path d="M20 11a8 8 0 10-2 6M20 4v7h-7"/>'),
    lock: I('<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 018 0v4"/>'), search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'), close: I('<path d="M6 6l12 12M18 6L6 18"/>')
  };

  /* ---- toast ---- */
  A.toast = function (msg, kind) {
    var box = A.$('.fcv-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'fcv-toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div'); t.className = 'fcv-toast ' + (kind || ''); t.textContent = msg; box.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(function () { t.remove(); }, 320); }, kind === 'bad' ? 7000 : 3600);
  };

  /* ---- modal: A.modal({title, body:Safe, actions:[{label, kind, onClick}]}) ---- */
  A.modal = function (opts) {
    var prev = document.activeElement;
    var ov = document.createElement('div'); ov.className = 'fcv-overlay';
    ov.innerHTML = '<div class="fcv-modal" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '"><header><h2 class="fcv-h2" style="font-size:30px">' + esc(opts.title) +
      '</h2><button class="fcv-icon-btn" data-x aria-label="Close">' + A.icons.close + '</button></header><div class="body"></div><footer></footer></div>';
    var body = A.$('.body', ov), foot = A.$('footer', ov);
    body.innerHTML = opts.body instanceof Safe ? opts.body.s : String(opts.body || '');
    var api = { el: ov, body: body, close: function () { document.removeEventListener('keydown', key); ov.remove(); if (prev && prev.focus) prev.focus(); if (opts.onClose) opts.onClose(); } };
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'fcv-btn ' + (a.kind || ''); b.textContent = a.label;
      b.addEventListener('click', function () { a.onClick(api, b); }); foot.appendChild(b);
    });
    function key(e) {
      if (e.key === 'Escape') api.close();
      if (e.key === 'Tab') {                                  // keep focus inside the dialog
        var f = A.$$('button,input,select,textarea,a[href]', ov).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return; var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    A.$('[data-x]', ov).addEventListener('click', api.close);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) api.close(); });
    document.body.appendChild(ov);
    var f0 = A.$('input,select,textarea', body) || A.$('.fcv-btn', foot); if (f0) f0.focus();
    return api;
  };
  A.confirm = function (title, text, okLabel, danger) {
    return new Promise(function (res) {
      A.modal({ title: title, body: A.html`<p style="margin:0">${text}</p>`, onClose: function () { res(false); }, actions: [
        { label: 'Cancel', onClick: function (m) { m.close(); } },
        { label: okLabel || 'OK', kind: danger ? 'danger' : 'primary', onClick: function (m) { res(true); m.el.remove(); } }] });
    });
  };

  /* ---- chip-list editor: add / edit / remove items. Value is a comma separated string. ---- */
  A.chipList = function (root, opts) {
    var items = A.splitList(opts.value), onChange = opts.onChange || function () {};
    function draw() {
      var h = items.map(function (t, i) {
        return '<span class="it"><span data-edit="' + i + '" title="Click to edit">' + esc(t) + '</span><button type="button" data-del="' + i + '" aria-label="Remove ' + esc(t) + '">&times;</button></span>';
      }).join('');
      root.innerHTML = '<div class="fcv-chips">' + (items.length ? h : '<span class="none">' + esc(opts.empty || 'Nothing added yet.') + '</span>') +
        '<button type="button" class="add" data-add>+ ' + esc(opts.addLabel || 'Add new item') + '</button></div>';
    }
    function commit() { onChange(items.join(', ')); draw(); }
    root.addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]'), ed = e.target.closest('[data-edit]'), add = e.target.closest('[data-add]');
      if (del) { items.splice(+del.dataset.del, 1); commit(); }
      else if (add) {
        add.outerHTML = '<span class="newrow"><input class="fcv-input" data-new placeholder="' + esc(opts.placeholder || 'Type it, then press Enter') + '" aria-label="New item"><button type="button" class="fcv-btn primary sm" data-ok>Add</button></span>';
        A.$('[data-new]', root).focus();
      } else if (e.target.closest('[data-ok]')) {
        var inp = A.$('[data-new]', root); A.splitList(inp.value).forEach(function (x) { items.push(x); }); commit(); var b = A.$('[data-add]', root); if (b) b.focus();
      } else if (ed) {
        var i = +ed.dataset.edit, inp2 = document.createElement('input'); inp2.className = 'fcv-input edit'; inp2.value = items[i]; inp2.setAttribute('aria-label', 'Edit item');
        ed.replaceWith(inp2); inp2.focus(); inp2.select();
        var finished = false; var done = function (save) { if (finished) return; finished = true; if (save) { var parts = A.splitList(inp2.value); if (parts.length) items.splice.apply(items, [i, 1].concat(parts)); else items.splice(i, 1); commit(); } else draw(); };
        inp2.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') done(false); });
        inp2.addEventListener('blur', function () { done(true); });
      }
    });
    root.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('[data-new]')) {
        if (e.key === 'Enter') { e.preventDefault(); A.splitList(e.target.value).forEach(function (x) { items.push(x); }); commit(); var b = A.$('[data-add]', root); if (b) b.click(); }
        else if (e.key === 'Escape') draw();
      }
    });
    draw();
    return { get: function () { return items.join(', '); } };
  };

  /* ---- statuses ---- */
  A.STATUS_CLASS = { 'New': 'new', 'Contacted': 'contacted', 'Site Visit Scheduled': 'visit', 'Quote Sent': 'quote', 'Accepted': 'accepted', 'Work in Progress': 'wip', 'Declined': 'declined', 'Completed': 'completed' };
  A.chip = function (status) { return A.html`<span class="fcv-chip ${A.STATUS_CLASS[status] || ''}"><i></i>${status}</span>`; };
  A.linkify = function (text) {                          // only real http(s) links become clickable
    return A.raw(esc(text).replace(/(https?:\/\/[^\s<]+)/gi, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">' + u.replace(/^https?:\/\//, '') + '</a>'; }));
  };
})();
