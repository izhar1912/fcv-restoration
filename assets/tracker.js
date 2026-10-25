/* The six tracker tabs (same as the lender workbook). Used by track.html (read-only) and admin.html (with edit buttons). */
(function () {
  'use strict';
  var A = window.FCVApp, html = A.html, raw = A.raw, I = A.icons;
  var T = (window.FCVTracker = {});

  T.TABS = [['summary', 'Lender Summary'], ['budget', 'Phase 1 Budget'], ['expenses', 'Expense Log'],
            ['supplements', 'Supplements & Change Orders'], ['draws', 'Draw Requests'], ['contract', 'Contract Overview']];
  T.STEPS = ['New', 'Contacted', 'Site Visit Scheduled', 'Quote Sent', 'Accepted', 'Work in Progress', 'Completed'];
  T.STEP_LABEL = { 'New': 'Request received', 'Contacted': 'We’ve been in touch', 'Site Visit Scheduled': 'Site visit', 'Quote Sent': 'Quote ready', 'Accepted': 'Quote accepted', 'Work in Progress': 'Work in progress', 'Completed': 'Work completed' };
  T.STAGE_TEXT = {
    'New': ['We’ve received your request', 'Our team is reviewing it and will call to arrange a site visit, usually within two business days.'],
    'Contacted': ['We’ve been in touch', 'Our team has reached out about your request. If we haven’t connected yet, please give us a call.'],
    'Site Visit Scheduled': ['Your site visit is scheduled', 'Once we’ve seen the work in person, we’ll confirm your actual price.'],
    'Quote Sent': ['Your quote is ready', 'Your quote is shown below. Call us if you’d like to talk it through.'],
    'Accepted': ['Quote accepted', 'Thank you. We’ll be in touch about getting your project started.'],
    'Work in Progress': ['Work is in progress', 'The tracker below shows costs, funding draws and approvals as they are recorded.'],
    'Completed': ['Your project is complete', 'Thank you for choosing FCV Restoration & Construction. The full record stays available here.'],
    'Declined': ['This request is closed', 'If you’d like to talk it through or start again, we’re always happy to help.']
  };
  var DRAW_CHIP = { 'Proposed - not submitted': 'dim', 'Submitted': 'info', 'Approved': 'ok', 'Partially funded': 'gold', 'Funded': 'ok', 'Rejected': 'bad' };
  var SUP_CHIP = { Draft: 'dim', Submitted: 'info', Approved: 'ok', Rejected: 'bad', Withdrawn: 'dim' };

  /* ---- all totals are worked out in whole cents so they always add up ---- */
  T.summary = function (d) {
    var r = d.request || {}, t = d.tracker || {};
    var base = r.actualPrice == null ? null : A.cents(r.actualPrice);
    var lineExt = function (l) { return Math.round(Number(l.quantity || 0) * A.cents(l.unitPrice) * (1 + Number(l.waste || 0) / 100)); };
    var sum = function (a, f) { return (a || []).reduce(function (n, x) { return n + f(x); }, 0); };
    var phase1 = sum(t.budget, lineExt);
    var approvedSup = sum((t.supplements || []).filter(function (s) { return s.status === 'Approved'; }), function (s) { return A.cents(s.amount); });
    var expenses = sum(t.expenses, function (e) { return A.cents(e.amount); });
    var itemized = sum(t.remaining, function (e) { return A.cents(e.amount); });
    var remainingBase = base == null ? null : base - phase1, revised = base == null ? null : base + approvedSup;
    return { base: base, phase1: phase1, lineExt: lineExt, remainingBase: remainingBase, share: base ? phase1 / base : null,
      approvedSup: approvedSup, revised: revised, expenses: expenses, budgetLess: revised == null ? null : revised - expenses,
      itemized: itemized, toItemize: remainingBase == null ? null : remainingBase - itemized,
      dReq: sum(t.draws, function (x) { return A.cents(x.requested); }), dApp: sum(t.draws, function (x) { return A.cents(x.approved); }), dDis: sum(t.draws, function (x) { return A.cents(x.disbursed); }),
      nApproved: (t.supplements || []).filter(function (s) { return s.status === 'Approved'; }).length };
  };

  var M = A.money;
  function ring(share) {
    var C = 2 * Math.PI * 42, f = Math.max(0, Math.min(1, share || 0));
    return raw('<svg class="fcv-ring" viewBox="0 0 100 100" role="img" aria-label="' + A.pct(share) + ' of the base estimate"><circle class="bg" cx="50" cy="50" r="42" fill="none" stroke-width="10"/>' +
      '<circle class="fg" cx="50" cy="50" r="42" fill="none" stroke-width="10" stroke-dasharray="' + (C * f).toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 50 50)"/>' +
      '<text x="50" y="58" text-anchor="middle">' + Math.round(f * 100) + '%</text></svg>');
  }
  var empty = function (title, text) { return html`<div class="fcv-empty">${raw(I.doc)}<b>${title}</b><p style="margin:0 auto;max-width:52ch">${text}</p></div>`; };
  var acts = function (table, id, edit) {
    return edit ? html`<td class="r"><div class="fcv-row no-print" style="justify-content:flex-end;gap:6px"><button class="fcv-icon-btn" data-act="edit" data-table="${table}" data-id="${id}" aria-label="Edit" title="Edit">${raw(I.edit)}</button><button class="fcv-icon-btn danger" data-act="delete" data-table="${table}" data-id="${id}" aria-label="Delete" title="Delete">${raw(I.trash)}</button></div></td>` : '';
  };
  var actTh = function (edit) { return edit ? html`<th class="r no-print"></th>` : ''; };
  var addBtn = function (table, label, edit) { return edit ? html`<button class="fcv-btn primary sm no-print" data-act="add" data-table="${table}">${raw(I.plus)} ${label}</button>` : ''; };
  var card = function (title, sub, head, table) {
    return html`<section class="fcv-card flush"><div class="fcv-card-head"><div><h3 class="fcv-h3">${title}</h3>${sub ? html`<div class="muted" style="font-size:14px;margin-top:6px">${sub}</div>` : ''}</div>${head}</div><div class="fcv-table-wrap">${table}</div></section>`;
  };
  var isPrelim = function (r) { return /prelim|not lender|not approved/i.test(r.lenderStatus || ''); };
  var kpi = function (cls, k, v, s) { return html`<div class="fcv-kpi ${cls}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`; };

  function summaryTab(d, edit, s) {
    var r = d.request, t = d.tracker, facts = [];
    if (r.lenderStatus) facts.push(html`<li><b>${r.lenderStatus}</b> <span class="faint">(current approval status of the figures in this tracker)</span></li>`);
    if (s.base != null) facts.push(html`<li>Total base renovation estimate: <b class="num">${M(s.base)}</b>${r.estimateSource ? html` <span class="faint">(${r.estimateSource.toLowerCase()})</span>` : ''}.</li>`);
    if (s.phase1 > 0 && s.base != null) facts.push(html`<li>The <b class="num">${M(s.phase1)}</b> initial materials request is <b>included</b> in the ${M(s.base)} total (${A.pct(s.share)}). It is not an additional fee, and it is not an approved disbursement.</li>`);
    if (s.remainingBase != null) facts.push(html`<li>Remaining base budget not yet itemized: <b class="num">${M(s.toItemize)}</b>. ${s.itemized === 0 ? 'A trade-by-trade written cost breakdown is required before it is used as a fully itemized fixed-price bid.' : html`<span class="faint">(${M(s.itemized)} has been broken down by trade so far.)</span>`}</li>`);
    facts.push(html`<li>${t.expenses.length === 0 ? html`<b>No expenses have been recorded.</b> An empty log does not prove that nothing has been spent.` : html`<b>${t.expenses.length} expense${t.expenses.length === 1 ? '' : 's'}</b> recorded, totaling <b class="num">${M(s.expenses)}</b>.`}</li>`);
    facts.push(html`<li>${t.supplements.length === 0 ? html`<b>No supplements or change orders have been recorded.</b>` : s.nApproved === 0 ? html`${t.supplements.length} supplement${t.supplements.length === 1 ? '' : 's'} on file, <b>none approved</b>. Only approved supplements change the budget.` : html`<b>${s.nApproved}</b> approved supplement${s.nApproved === 1 ? '' : 's'} adding <b class="num">${M(s.approvedSup)}</b> to the budget.`}</li>`);
    t.draws.forEach(function (x) {
      var bits = x.status === 'Proposed - not submitted' ? 'proposed, not submitted, approved or paid' : x.status === 'Submitted' ? 'submitted, awaiting the lender’s decision' : x.status === 'Rejected' ? 'rejected' : 'approved ' + M(A.cents(x.approved)) + ', disbursed ' + M(A.cents(x.disbursed));
      facts.push(html`<li><b class="mono">${x.id}</b>: ${x.purpose}. Requested <b class="num">${M(A.cents(x.requested))}</b>; ${bits}.</li>`);
    });
    (r.notes || []).forEach(function (n) { facts.push(html`<li>${n}</li>`); });
    var scale = Math.max(s.dReq, s.dApp, s.dDis, 1), w = function (v) { return Math.min(100, v / scale * 100).toFixed(1); };
    return html`<div class="fcv-stack" style="--gap:18px">
      <div class="fcv-grid c4">
        ${kpi('hero', 'Total base renovation estimate', M(s.base), r.estimateSource || 'Overall project estimate')}
        ${kpi('', 'Proposed Phase 1 materials draw', M(s.phase1), 'Part of the total estimate. Not an extra fee.')}
        ${kpi('', 'Remaining base budget', M(s.remainingBase), 'Not yet itemized by trade. Not an unpaid balance.')}
        <div class="fcv-kpi fcv-row"><div style="flex:1"><div class="k">Initial draw share</div><div class="s" style="margin-top:8px">of the overall estimate</div></div>${ring(s.share)}</div>
      </div>
      <div class="fcv-grid c4">
        ${kpi('', 'Approved supplement additions', M(s.approvedSup), t.supplements.length ? s.nApproved + ' approved of ' + t.supplements.length : 'None recorded')}
        ${kpi('', 'Revised total project budget', M(s.revised), 'Base estimate plus approved supplements')}
        ${kpi('', 'Expenses logged', M(s.expenses), t.expenses.length ? t.expenses.length + ' recorded' : 'Only entries recorded here')}
        ${kpi('', 'Funding disbursed', M(s.dDis), 'Actually paid out, not just requested')}
      </div>
      <div class="fcv-grid c2">
        <section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:14px">Draw requests at a glance</h3>${t.draws.length ? html`<div class="fcv-funnel">
          <div class="f req"><span>Requested</span><div class="track"><i style="width:${w(s.dReq)}%"></i></div><span class="amt num">${M(s.dReq)}</span></div>
          <div class="f app"><span>Approved</span><div class="track"><i style="width:${w(s.dApp)}%"></i></div><span class="amt num">${M(s.dApp)}</span></div>
          <div class="f dis"><span>Disbursed</span><div class="track"><i style="width:${w(s.dDis)}%"></i></div><span class="amt num">${M(s.dDis)}</span></div></div>
          <p class="muted" style="margin:16px 0 0;font-size:14px">A request is not an approval, and an approval is not a payment. Each stage is recorded separately.</p>` : empty('No draw requests', 'Nothing has been requested yet.')}</section>
        <section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:10px">Revised budget less expenses</h3><div class="fcv-kpi" style="padding:0;border:0"><div class="v num" style="font-size:52px;margin-top:0">${M(s.budgetLess)}</div><div class="s">A budget calculation, not a bank balance.</div></div>
          <div class="fcv-bar" style="height:8px;margin-top:20px"><i style="width:${s.revised ? Math.min(100, s.expenses / s.revised * 100).toFixed(2) : 0}%"></i></div><div class="muted" style="font-size:13px;margin-top:8px">${s.revised ? A.pct(s.expenses / s.revised) : '0.00%'} of the revised budget recorded as spent</div></section>
      </div>
      <div class="fcv-grid c2">
        <section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:8px">Project status &amp; notes</h3><ul class="fcv-list">${facts}</ul></section>
        <section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:8px">How to read this tracker</h3><ul class="fcv-list">
          <li>Requested, approved and disbursed amounts are tracked <b>separately</b>. A requested draw is not an approval and not a payment.</li>
          <li>Supplements and change orders change the budget <b>only when approved</b>, and every approval is recorded with its proof.</li>
          <li>Expense totals include <b>only entries recorded here</b>. No entry does not prove no spending.</li>
          <li>Remaining base budget is the part of the estimate not yet itemized by trade. It is <b>not</b> an unpaid balance.</li>
          <li>Figures are estimates and requests, not payments or approvals, unless marked otherwise.</li></ul></section>
      </div>
      <section class="fcv-card"><h3 class="fcv-h3" style="margin-bottom:12px">Project details</h3><dl class="fcv-kv"><dt>Client</dt><dd>${r.name}</dd><dt>Property</dt><dd>${[r.address, r.city, r.zip].filter(Boolean).join(', ') || '—'}</dd>
        <dt>Project</dt><dd>${r.title || 'Your project'}${r.phaseLabel ? html` <span class="faint">· ${r.phaseLabel}</span>` : ''}</dd><dt>Contractor</dt><dd>${d.company ? d.company.name : 'FCV Restoration & Construction'}</dd><dt>Reference</dt><dd><span class="fcv-code">${r.reference}</span></dd></dl></section>
    </div>`;
  }

  function budgetTab(d, edit, s) {
    var r = d.request, lines = d.tracker.budget, total = s.phase1 || 1;
    var table = lines.length ? html`<table class="fcv-t"><thead><tr><th>Code</th><th>Material / work category</th><th class="r">Quantity</th><th>Unit</th><th class="r">Unit price</th><th class="r">Waste</th><th class="r">Extended amount</th><th>Estimation basis</th>${actTh(edit)}</tr></thead><tbody>
      ${lines.map(function (l) { var ext = s.lineExt(l); return html`<tr><td><span class="fcv-code">${l.code || '—'}</span></td><td><b>${l.category}</b><div class="fcv-bar"><i style="width:${(ext / total * 100).toFixed(1)}%"></i></div></td><td class="r num">${A.qty(l.quantity)}</td><td>${l.unit}</td><td class="r num">${A.dollars(l.unitPrice)}</td><td class="r num">${A.qty(l.waste)}%</td><td class="r num"><b>${M(ext)}</b><span class="sub">${A.pct(ext / total)}</span></td><td class="muted">${l.basis}</td>${acts('budget', l.id, edit)}</tr>`; })}
      </tbody><tfoot><tr><td></td><td>Total Phase 1 materials budget</td><td></td><td></td><td></td><td></td><td class="r num">${M(s.phase1)}</td><td></td>${edit ? html`<td></td>` : ''}</tr></tfoot></table>` : empty('No budget lines yet', 'The Phase 1 materials budget has not been itemized.');
    return html`<div class="fcv-stack" style="--gap:16px">${isPrelim(r) ? html`<div class="fcv-callout">${raw(I.alert)}<p><b>Preliminary.</b> Quantities and prices are provisional until confirmed by field measurement and vendor quotes.${s.base != null ? ' The Phase 1 materials amount is part of the ' + M(s.base) + ' total estimate.' : ''}</p></div>` : ''}
      ${card('Phase 1 · materials budget', 'Extended amount = quantity × unit price × (1 + waste %)', addBtn('budget', 'Add line', edit), table)}
      ${s.remainingBase != null ? html`<div class="fcv-callout">${raw(I.info)}<p>The remaining <b class="num">${M(s.remainingBase)}</b> is not allocated in this Phase 1 materials sheet. Labor, trade details, permits, code scope and field measurements need a separate itemized cost schedule.</p></div>` : ''}</div>`;
  }

  function expensesTab(d, edit, s) {
    var rows = d.tracker.expenses;
    var table = rows.length ? html`<table class="fcv-t"><thead><tr><th>ID</th><th>Date</th><th>Vendor</th><th>Budget category</th><th>What was purchased</th><th class="r">Amount paid</th><th>Notes</th>${actTh(edit)}</tr></thead><tbody>
      ${rows.map(function (e) { return html`<tr><td><span class="fcv-code">${e.id}</span></td><td class="num" style="white-space:nowrap">${A.date(e.date)}</td><td><b>${e.vendor}</b></td><td>${e.category || '—'}</td><td>${e.description}${e.receipt ? html`<span class="sub">Receipt: ${A.linkify(e.receipt)}</span>` : ''}</td><td class="r num"><b>${A.dollars(e.amount)}</b></td><td class="muted">${e.notes}</td>${acts('expenses', e.id, edit)}</tr>`; })}
      </tbody><tfoot><tr><td colspan="5">Total recorded expenses</td><td class="r num">${M(s.expenses)}</td><td></td>${edit ? html`<td></td>` : ''}</tr></tfoot></table>`
      : empty('No expenses recorded yet', 'This log only contains purchases that have been entered. An empty log is not proof that nothing has been bought.');
    return card('Material purchases & receipt log', 'Only purchases that have actually been recorded appear here.', addBtn('expenses', 'Add expense', edit), table);
  }

  function supplementsTab(d, edit, s) {
    var rows = d.tracker.supplements, totalReq = rows.reduce(function (n, x) { return n + A.cents(x.amount); }, 0);
    var table = rows.length ? html`<table class="fcv-t"><thead><tr><th>ID</th><th>Date</th><th>Scope / reason</th><th class="r">Amount requested</th><th>Status</th><th class="r">Approved budget impact</th><th>Proof &amp; notes</th>${actTh(edit)}</tr></thead><tbody>
      ${rows.map(function (x) { return html`<tr><td><span class="fcv-code">${x.id}</span></td><td class="num" style="white-space:nowrap">${A.date(x.date) || '—'}</td><td><b>${x.scope}</b>${x.vendor ? html`<span class="sub">${x.vendor}</span>` : ''}${x.support ? html`<span class="sub">Support: ${A.linkify(x.support)}</span>` : ''}</td><td class="r num">${A.dollars(x.amount)}</td><td><span class="fcv-chip ${SUP_CHIP[x.status] || ''}">${x.status}</span></td><td class="r num">${x.status === 'Approved' ? html`<b>${A.dollars(x.amount)}</b><span class="sub">on ${A.date(x.approvedOn)}</span>` : '—'}</td><td class="muted">${x.proof ? html`<b style="color:var(--midnight)">Proof:</b> ${A.linkify(x.proof)}<br>` : ''}${x.notes}</td>${acts('supplements', x.id, edit)}</tr>`; })}
      </tbody><tfoot><tr><td colspan="3">Totals</td><td class="r num">${M(totalReq)}</td><td></td><td class="r num">${M(s.approvedSup)}</td><td></td>${edit ? html`<td></td>` : ''}</tr></tfoot></table>`
      : empty('No supplements or change orders', 'Nothing has been requested. Only supplements with the status Approved ever change the project budget.');
    return card('Supplements & change orders', 'Only “Approved” supplements increase the budget. Drafts and submissions never do.', addBtn('supplements', 'Add supplement', edit), table);
  }

  function drawsTab(d, edit, s) {
    var rows = d.tracker.draws;
    var one = function (x) {
      var rq = A.cents(x.requested), m = Math.max(rq, A.cents(x.approved), 1), w = function (v) { return (v / m * 100).toFixed(1); };
      return html`<article class="fcv-card"><div class="fcv-row between wrap" style="align-items:flex-start"><div><div class="fcv-row wrap" style="gap:10px"><span class="fcv-code">${x.id}</span><span class="fcv-chip ${DRAW_CHIP[x.status] || ''}">${x.status}</span></div><h3 class="fcv-h3" style="margin:12px 0 4px">${x.purpose}</h3><div class="muted" style="font-size:14px">${x.date ? 'Submitted ' + A.date(x.date) : 'Not submitted yet'}</div></div>
        ${edit ? html`<div class="fcv-row no-print" style="gap:6px"><button class="fcv-icon-btn" data-act="edit" data-table="draws" data-id="${x.id}" aria-label="Edit" title="Edit">${raw(I.edit)}</button><button class="fcv-icon-btn danger" data-act="delete" data-table="draws" data-id="${x.id}" aria-label="Delete" title="Delete">${raw(I.trash)}</button></div>` : ''}</div>
        <div class="fcv-funnel" style="margin-top:20px"><div class="f req"><span>Requested</span><div class="track"><i style="width:${w(rq)}%"></i></div><span class="amt num">${M(rq)}</span></div>
          <div class="f app"><span>Approved</span><div class="track"><i style="width:${w(A.cents(x.approved))}%"></i></div><span class="amt num">${x.approved == null ? 'Not yet approved' : A.dollars(x.approved)}</span></div>
          <div class="f dis"><span>Disbursed</span><div class="track"><i style="width:${w(A.cents(x.disbursed))}%"></i></div><span class="amt num">${x.disbursed == null ? 'Nothing paid out' : A.dollars(x.disbursed)}</span></div></div>
        ${x.notes ? html`<p class="muted" style="margin:16px 0 0">${x.notes}</p>` : ''}</article>`;
    };
    return html`<div class="fcv-stack" style="--gap:16px"><div class="fcv-row between wrap"><div><h3 class="fcv-h3">Funding draw requests</h3><div class="muted" style="font-size:14px;margin-top:6px">Requested, approved and disbursed are separate facts. Approved and disbursed stay empty until the lender confirms them.</div></div>${addBtn('draws', 'Add draw request', edit)}</div>
      <div class="fcv-grid c3"><div class="fcv-kpi"><div class="k">Total requested</div><div class="v num">${M(s.dReq)}</div></div><div class="fcv-kpi"><div class="k">Total approved</div><div class="v num">${M(s.dApp)}</div></div><div class="fcv-kpi"><div class="k">Total disbursed</div><div class="v num">${M(s.dDis)}</div></div></div>
      ${rows.length ? rows.map(one) : html`<section class="fcv-card">${empty('No draw requests', 'No funding has been requested yet.')}</section>`}</div>`;
  }

  function contractTab(d, edit, s) {
    var r = d.request, rem = d.tracker.remaining;
    var items = [
      ['Base total renovation estimate', s.base, 'The total estimate for the project.' + (r.estimateSource ? ' ' + r.estimateSource + '.' : ''), true],
      ['Initial Phase 1 materials allowance', s.phase1, 'See the Phase 1 Budget itemization.'],
      ['Remaining base contract amount', s.remainingBase, 'Not yet allocated by trade. Does not mean an unpaid balance.'],
      ['Approved supplement amount', s.approvedSup, 'Only approved supplements count.'],
      ['Revised estimated job budget', s.revised, 'Base estimate plus approved supplements.', true],
      ['Documented expenses entered', s.expenses, 'Payments entered in the Expense Log only.'],
      ['Funding actually disbursed', s.dDis, 'From Draw Requests: the amount paid out, not the amount requested.'],
      ['Budget less recorded expenses', s.budgetLess, 'A budget calculation, not a bank balance.']];
    return html`<div class="fcv-stack" style="--gap:16px">
      ${card('Contract estimate · project cost & draw plan', [r.name, r.address].filter(Boolean).join(' · '), '', html`<table class="fcv-t"><thead><tr><th>Financial item</th><th class="r">Amount</th><th>Basis</th></tr></thead><tbody>
        ${items.map(function (x) { return html`<tr><td>${x[3] ? html`<b>${x[0]}</b>` : x[0]}</td><td class="r num">${x[3] ? html`<b>${M(x[1])}</b>` : M(x[1])}</td><td class="muted">${x[2]}</td></tr>`; })}
        <tr><td>Initial draw / original total</td><td class="r num">${A.pct(s.share)}</td><td class="muted">A ratio, not evidence of lender approval.</td></tr></tbody></table>`)}
      ${card('Remaining contract amount · breakdown by trade', 'Entered as written quotes or signed scopes are received.', addBtn('remaining', 'Add item', edit), rem.length ? html`<table class="fcv-t"><thead><tr><th>Category / trade</th><th class="r">Amount</th><th>Note</th>${actTh(edit)}</tr></thead><tbody>${rem.map(function (x) { return html`<tr><td><b>${x.category}</b></td><td class="r num">${A.dollars(x.amount)}</td><td class="muted">${x.note}</td>${acts('remaining', x.id, edit)}</tr>`; })}</tbody>
        <tfoot><tr><td>Total remaining amount itemized</td><td class="r num">${M(s.itemized)}</td><td></td>${edit ? html`<td></td>` : ''}</tr><tr><td>Balance still to itemize</td><td class="r num">${M(s.toItemize)}</td><td></td>${edit ? html`<td></td>` : ''}</tr></tfoot></table>` : empty('Nothing itemized yet', 'The remaining amount has not been broken down by trade.'))}
    </div>`;
  }

  var RENDER = { summary: summaryTab, budget: budgetTab, expenses: expensesTab, supplements: supplementsTab, draws: drawsTab, contract: contractTab };

  /** Tab bar + the selected tab. data = {request, tracker, company}. */
  T.view = function (data, tab, edit) {
    var t = data.tracker, s = T.summary(data), counts = { budget: t.budget.length, expenses: t.expenses.length, supplements: t.supplements.length, draws: t.draws.length };
    if (!RENDER[tab]) tab = 'summary';
    return html`<div class="fcv-stack" style="--gap:22px"><div class="fcv-tabs no-print" role="tablist" aria-label="Project tracker">${T.TABS.map(function (x) {
      return html`<button class="fcv-tab" role="tab" id="tab-${x[0]}" aria-selected="${String(x[0] === tab)}" aria-controls="panel" data-tab="${x[0]}">${x[1]}${counts[x[0]] ? html`<span class="n">${counts[x[0]]}</span>` : ''}</button>`; })}</div>
      <div id="panel" role="tabpanel" aria-labelledby="tab-${tab}">${RENDER[tab](data, !!edit, s)}</div></div>`;
  };

  /** Click and arrow-key handling for the tab bar. onTab(tabKey). */
  T.bindTabs = function (root, onTab) {
    A.$$('[data-tab]', root).forEach(function (b) { b.addEventListener('click', function () { onTab(b.dataset.tab, true); }); });
    var bar = A.$('.fcv-tabs', root);
    if (bar) bar.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var keys = T.TABS.map(function (x) { return x[0]; }), cur = (A.$('[aria-selected=true]', bar) || {}).dataset.tab, i = keys.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1);
      onTab(keys[(i + keys.length) % keys.length], true);
    });
  };

  /** The progress steps (seven of them; a declined request shows a closed notice instead). */
  T.stepper = function (status) {
    if (status === 'Declined') return '';
    var idx = T.STEPS.indexOf(status);
    return html`<ol class="fcv-stepper" aria-label="Progress">${T.STEPS.map(function (k, i) {
      return html`<li class="fcv-step ${i < idx ? 'done' : i === idx ? 'now' : ''}" ${i === idx ? raw('aria-current="step"') : ''}><div class="fcv-node">${i < idx ? raw(I.check) : i + 1}</div><div class="fcv-lab">${T.STEP_LABEL[k]}</div></li>`; })}</ol>`;
  };
})();
