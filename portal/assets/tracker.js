/* FCV portal: the project view used by clients (read-only) and by the administrator (with edit controls).
   The six tabs mirror the lender workbook sheet for sheet. */
(function () {
  'use strict';
  const { html, raw, money, dateOnly, pct, qty, icons } = window.FCV;

  // Rename a tab for everyone by changing its label here.
  const TABS = [
    ['summary', 'Lender Summary'], ['budget', 'Phase 1 Budget'], ['expenses', 'Expense Log'],
    ['supplements', 'Supplements & Change Orders'], ['draws', 'Draw Requests'], ['contract', 'Contract Overview']
  ];
  const STEPS = [
    ['new', 'Request received'], ['contacted', 'We’ve been in touch'], ['site_visit', 'Site visit'], ['quote_sent', 'Quote ready'],
    ['accepted', 'Quote accepted'], ['work_in_progress', 'Work in progress'], ['completed', 'Work completed']
  ];
  const STAGE_TEXT = {
    new: ['We’ve received your request', 'Our team is reviewing it and will call to arrange a site visit, usually within two business days.'],
    contacted: ['We’ve been in touch', 'Our team has reached out about your request. If we haven’t connected yet, please give us a call.'],
    site_visit: ['Your site visit is scheduled', 'Once we’ve seen the work in person, we’ll confirm your actual price.'],
    quote_sent: ['Your quote is ready', 'Your quote is shown below. Call us if you’d like to talk it through.'],
    accepted: ['Quote accepted', 'Thank you. We’ll be in touch about getting your project started.'],
    work_in_progress: ['Work is in progress', 'The project tracker below shows costs, funding draws and receipts as they are recorded.'],
    completed: ['Your project is complete', 'Thank you for choosing FCV Restoration & Construction. The full record remains available here.'],
    declined: ['This request is closed', 'If you’d like to talk it through or start again, we’re always happy to help.']
  };
  const STATUS_CHIP = { Draft: 'dim', Submitted: 'info', Approved: 'ok', Rejected: 'bad', Withdrawn: 'dim', 'Proposed - not submitted': 'dim', 'Partially funded': 'gold', Funded: 'ok' };
  const KIND = { receipt: 'Receipt', supporting: 'Supporting', contract: 'Contract', other: 'Other' };
  const fileSize = (n) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  const ring = (share) => {
    const C = 2 * Math.PI * 42; const f = Math.max(0, Math.min(1, share || 0));
    return raw(`<svg class="ring" viewBox="0 0 100 100" role="img" aria-label="${pct(share)} of the base estimate"><defs><linearGradient id="goldRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbdc86"/><stop offset=".5" stop-color="#f3b41e"/><stop offset="1" stop-color="#b98a12"/></linearGradient></defs><circle class="bg" cx="50" cy="50" r="42" fill="none" stroke-width="9"/><circle class="fg" cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - f)).toFixed(2)}" transform="rotate(-90 50 50)"/><text x="50" y="56" text-anchor="middle">${share == null ? '—' : (share * 100).toFixed(1) + '%'}</text></svg>`);
  };

  const docsFor = (t, type, id) => (t.documents || []).filter((d) => d.linkedType === type && d.linkedId === id);
  const docLink = (d) => html`<a class="attach" href="/api/documents/${d.id}/download" title="${d.title} (${fileSize(d.sizeBytes)})" download>${raw(icons.clip)}<span>${d.fileName}</span></a>`;
  const attachCell = (t, type, id, edit) => html`${docsFor(t, type, id).map(docLink)}${edit ? html`<button class="icon-btn no-print" data-act="attach" data-link-type="${type}" data-link-id="${id}" title="Attach a receipt or document" aria-label="Attach a document">${raw(icons.upload)}</button>` : ''}`;
  const acts = (entity, id, edit) => edit ? html`<td class="r"><div class="row-actions no-print"><button class="icon-btn" data-act="edit" data-entity="${entity}" data-id="${id}" aria-label="Edit" title="Edit">${raw(icons.edit)}</button><button class="icon-btn danger" data-act="delete" data-entity="${entity}" data-id="${id}" aria-label="Delete" title="Delete">${raw(icons.trash)}</button></div></td>` : '';
  const actTh = (edit) => (edit ? html`<th class="r no-print"></th>` : '');
  const addBtn = (entity, label, edit) => (edit ? html`<button class="btn gold sm no-print" data-act="add" data-entity="${entity}">${raw(icons.plus)} ${label}</button>` : '');
  const tableCard = (title, sub, head, table, edit) => html`<section class="card pad-0"><div class="card-head"><div><h3>${title}</h3>${sub ? html`<div class="muted" style="font-size:.875rem;margin-top:4px">${sub}</div>` : ''}</div>${head}</div><div class="table-wrap">${table}</div></section>`;
  const emptyBlock = (title, text) => html`<div class="empty">${raw(icons.doc)}<b>${title}</b><p style="margin:0;max-width:52ch;margin-inline:auto">${text}</p></div>`;
  const isPrelim = (p) => /prelim|not lender|not approved/i.test(p.lenderStatus || '');

  /* ---------------------------------------------------------------- the six tabs */
  function summaryTab(b, edit) {
    const p = b.project, t = b.tracker, s = t.summary;
    const kpi = (cls, k, v, sub, tag) => html`<div class="kpi ${cls}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${sub}</div>${tag ? html`<div style="margin-top:14px"><span class="chip gold">${tag}</span></div>` : ''}</div>`;
    const draws = t.draws, dReq = s.draws.requestedCents, dApp = s.draws.approvedCents, dDis = s.draws.disbursedCents;
    const scale = Math.max(dReq, dApp, dDis, 1);
    const w = (v) => Math.min(100, (v / scale) * 100).toFixed(1);
    const facts = [];
    facts.push(html`<li><b>${p.lenderStatus}</b> <span class="faint">(current approval status of the figures in this tracker)</span></li>`);
    if (s.baseEstimateCents != null) facts.push(html`<li>Total base renovation estimate: <b class="num">${money(s.baseEstimateCents)}</b>${p.estimateSource ? html` <span class="faint">(${p.estimateSource.toLowerCase()})</span>` : ''}.</li>`);
    if (s.phase1TotalCents > 0 && s.baseEstimateCents != null) facts.push(html`<li>The <b class="num">${money(s.phase1TotalCents)}</b> initial materials request is <b>included</b> in the ${money(s.baseEstimateCents)} total (${pct(s.initialDrawShare)}). It is not an additional fee, and it is not an approved disbursement.</li>`);
    if (s.remainingBaseCents != null) facts.push(html`<li>Remaining base budget not yet itemized: <b class="num">${money(s.balanceToItemizeCents)}</b>. ${s.itemizedRemainingCents === 0 ? 'A trade-by-trade written cost breakdown is required before it is used as a fully itemized fixed-price bid.' : html`<span class="faint">(${money(s.itemizedRemainingCents)} has been broken down by trade so far.)</span>`}</li>`);
    facts.push(html`<li>${s.counts.expenses === 0 ? html`<b>No expenses have been recorded.</b> An empty log does not prove that nothing has been spent.` : html`<b>${s.counts.expenses} expense${s.counts.expenses === 1 ? '' : 's'}</b> recorded, totaling <b class="num">${money(s.expensesCents)}</b>.`}</li>`);
    facts.push(html`<li>${s.counts.supplements === 0 ? html`<b>No supplements or change orders have been recorded.</b>` : s.counts.approvedSupplements === 0 ? html`${s.counts.supplements} supplement${s.counts.supplements === 1 ? '' : 's'} on file, <b>none approved</b>. Only approved supplements change the budget.` : html`<b>${s.counts.approvedSupplements}</b> approved supplement${s.counts.approvedSupplements === 1 ? '' : 's'} add <b class="num">${money(s.approvedSupplementsCents)}</b> to the budget.`}</li>`);
    for (const d of draws) {
      const bits = d.status === 'Proposed - not submitted' ? 'proposed, not submitted, approved or paid' : d.status === 'Submitted' ? 'submitted, awaiting the lender’s decision' : d.status === 'Rejected' ? 'rejected' : html`approved ${money(d.amountApprovedCents)}, disbursed ${money(d.amountDisbursedCents || 0)}`;
      facts.push(html`<li><b class="mono">${d.drawRef}</b>: ${d.purpose}. Requested <b class="num">${money(d.amountRequestedCents)}</b>; ${bits}.</li>`);
    }
    for (const n of p.notes || []) facts.push(html`<li>${n}</li>`);
    return html`<div class="stack" style="--gap:18px">
      <div class="grid cols-4">
        ${kpi('hero', 'Total base renovation estimate', money(s.baseEstimateCents), p.estimateSource || 'Overall project estimate', p.lenderStatus.split('/')[0].trim())}
        ${kpi('', 'Proposed Phase 1 materials draw', money(s.phase1TotalCents), 'Part of the total estimate. Not an extra fee.')}
        ${kpi('', 'Remaining base budget', money(s.remainingBaseCents), 'Not yet itemized by trade. Not an unpaid balance.')}
        <div class="kpi" style="display:flex;gap:16px;align-items:center"><div><div class="k">Initial draw share</div><div class="s" style="margin-top:8px">of the overall estimate</div></div>${ring(s.initialDrawShare)}</div>
      </div>
      <div class="grid cols-4">
        ${kpi('', 'Approved supplement additions', money(s.approvedSupplementsCents), s.counts.supplements ? `${s.counts.approvedSupplements} approved of ${s.counts.supplements}` : 'None recorded')}
        ${kpi('', 'Revised total project budget', money(s.revisedBudgetCents), 'Base estimate plus approved supplements')}
        ${kpi('', 'Expenses logged', money(s.expensesCents), s.counts.expenses ? `${s.counts.expenses} recorded` : 'Only entries recorded here')}
        ${kpi('', 'Funding disbursed', money(dDis), 'Actually paid out, not just requested')}
      </div>
      <div class="grid cols-2">
        <section class="card"><h3>Draw requests at a glance</h3>${draws.length ? html`<div class="funnel">
          <div class="f req"><span>Requested</span><div class="track"><i style="width:${w(dReq)}%"></i></div><span class="amt num">${money(dReq)}</span></div>
          <div class="f app"><span>Approved</span><div class="track"><i style="width:${w(dApp)}%"></i></div><span class="amt num">${money(dApp)}</span></div>
          <div class="f dis"><span>Disbursed</span><div class="track"><i style="width:${w(dDis)}%"></i></div><span class="amt num">${money(dDis)}</span></div></div>
          <p class="muted" style="margin:18px 0 0;font-size:.875rem">A request is not an approval, and an approval is not a payment. Each stage is recorded separately.</p>` : emptyBlock('No draw requests', 'Nothing has been requested yet.')}</section>
        <section class="card"><h3>Revised budget less expenses</h3><div class="kpi" style="padding:0;border:0;background:none"><div class="v num" style="font-size:2.4rem;margin-top:0">${money(s.budgetLessExpensesCents)}</div><div class="s">A budget calculation, not a bank balance.</div></div>
          <div class="bar" style="height:8px;margin-top:20px"><i style="width:${s.revisedBudgetCents ? Math.min(100, (s.expensesCents / s.revisedBudgetCents) * 100).toFixed(2) : 0}%"></i></div><div class="muted" style="font-size:.8125rem;margin-top:8px">${s.revisedBudgetCents ? pct(s.expensesCents / s.revisedBudgetCents) : '0.00%'} of the revised budget recorded as spent</div></section>
      </div>
      <div class="grid cols-2">
        <section class="card"><h3>Project status &amp; lender notes</h3><ul class="list">${facts}</ul></section>
        <section class="card"><h3>How to read this tracker</h3><ul class="list plain">
          <li>Requested, approved and disbursed amounts are tracked <b>separately</b>. A requested draw is not an approval and not a payment.</li>
          <li>Supplements and change orders change the budget <b>only when approved</b>, and every approval is recorded with its proof.</li>
          <li>Expense totals include <b>only entries recorded here</b>. No entry does not prove no spending.</li>
          <li>Remaining base budget is the part of the estimate not yet itemized by trade. It is <b>not</b> an unpaid balance.</li>
          <li>Figures are estimates and requests, not payments or approvals, unless marked otherwise.</li></ul></section>
      </div>
      <section class="card"><h3>Project details</h3><dl class="kv"><dt>Client</dt><dd>${p.clientName}</dd><dt>Property</dt><dd>${p.address || '—'}</dd><dt>Project</dt><dd>${p.title}${p.phaseLabel ? html` <span class="faint">· ${p.phaseLabel}</span>` : ''}</dd><dt>Contractor</dt><dd>${p.contractor}</dd><dt>Project code</dt><dd><span class="code">${p.code}</span></dd><dt>Last updated</dt><dd>${window.FCV.dateTime(p.updatedAt)}</dd></dl></section>
    </div>`;
  }

  function budgetTab(b, edit) {
    const p = b.project, t = b.tracker, s = t.summary, lines = t.budgetLines;
    const total = s.phase1TotalCents || 1;
    const table = lines.length ? html`<table class="t"><thead><tr><th>Code</th><th>Material / work category</th><th class="r">Quantity</th><th>Unit</th><th class="r">Unit price</th><th class="r">Waste</th><th class="r">Extended amount</th><th>Estimation basis</th>${actTh(edit)}</tr></thead><tbody>
      ${lines.map((l) => html`<tr><td><span class="code">${l.code || '—'}</span></td><td><b>${l.category}</b><div class="bar"><i style="width:${((l.extendedCents / total) * 100).toFixed(1)}%"></i></div></td><td class="r num">${qty(l.quantity)}</td><td>${l.unit}</td><td class="r num">${money(l.unitPriceCents)}</td><td class="r num">${qty(l.wastePercent)}%</td><td class="r num"><b>${money(l.extendedCents)}</b><span class="sub">${((l.extendedCents / total) * 100).toFixed(1)}% of Phase 1</span></td><td class="muted">${l.basis}</td>${acts('budget-lines', l.id, edit)}</tr>`)}
      </tbody><tfoot><tr><td></td><td>Total Phase 1 materials budget</td><td></td><td></td><td></td><td></td><td class="r num">${money(s.phase1TotalCents)}</td><td></td>${edit ? html`<td></td>` : ''}</tr></tfoot></table>` : emptyBlock('No budget lines yet', 'The Phase 1 materials budget has not been itemized.');
    return html`<div class="stack" style="--gap:16px">${isPrelim(p) ? html`<div class="callout"><span>${raw(icons.alert)}</span><p><b>Preliminary.</b> Quantities and prices are provisional until confirmed by field measurement and vendor quotes. The Phase 1 materials amount is part of the ${money(s.baseEstimateCents)} total estimate.</p></div>` : ''}
      ${tableCard('Phase 1 · preliminary materials budget', 'Extended amount = quantity × unit price × (1 + waste %)', addBtn('budget-lines', 'Add line', edit), table, edit)}
      ${s.remainingBaseCents != null ? html`<div class="callout"><span>${raw(icons.info)}</span><p>The remaining <b class="num">${money(s.remainingBaseCents)}</b> is not allocated in this Phase 1 materials sheet. Labor, trade details, permits, code scope and field measurements require a separate itemized cost schedule.</p></div>` : ''}</div>`;
  }

  function expensesTab(b, edit) {
    const t = b.tracker, s = t.summary, rows = t.expenses;
    const table = rows.length ? html`<table class="t"><thead><tr><th>Expense ID</th><th>Date</th><th>Vendor</th><th>Budget category</th><th>What was purchased</th><th class="r">Amount paid</th><th>Notes / verification</th>${actTh(edit)}</tr></thead><tbody>
      ${rows.map((e) => html`<tr><td><span class="code">${e.expenseRef}</span></td><td class="num" style="white-space:nowrap">${dateOnly(e.purchasedOn)}</td><td><b>${e.vendor}</b></td><td>${e.budgetCategory || '—'}</td><td>${e.description}<div>${attachCell(t, 'expense', e.id, edit)}${e.receiptRef ? html`<span class="sub">Ref: ${e.receiptRef}</span>` : ''}</div></td><td class="r num"><b>${money(e.amountCents)}</b></td><td class="muted">${e.notes}</td>${acts('expenses', e.id, edit)}</tr>`)}
      </tbody><tfoot><tr><td colspan="5">Total recorded expenses</td><td class="r num">${money(s.expensesCents)}</td><td></td>${edit ? html`<td></td>` : ''}</tr></tfoot></table>`
      : emptyBlock('No expenses recorded yet', 'This log only contains purchases that have been entered. An empty log is not proof that nothing has been bought. Receipts are attached to each entry when available.');
    return tableCard('Material purchases & receipt log', 'Only purchases that have actually been recorded appear here.', addBtn('expenses', 'Add expense', edit), table, edit);
  }

  function supplementsTab(b, edit) {
    const t = b.tracker, s = t.summary, rows = t.supplements;
    const totalReq = rows.reduce((n, r) => n + r.amountCents, 0);
    const table = rows.length ? html`<table class="t"><thead><tr><th>ID</th><th>Date</th><th>Scope / reason</th><th class="r">Amount requested</th><th>Status</th><th class="r">Approved budget impact</th><th>Notes</th>${actTh(edit)}</tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><span class="code">${r.supplementRef}</span></td><td class="num" style="white-space:nowrap">${dateOnly(r.requestedOn) || '—'}</td><td><b>${r.scope}</b>${r.vendorTrade ? html`<span class="sub">${r.vendorTrade}</span>` : ''}<div>${attachCell(t, 'supplement', r.id, edit)}${r.supportRef ? html`<span class="sub">Ref: ${r.supportRef}</span>` : ''}</div></td><td class="r num">${money(r.amountCents)}</td><td><span class="chip ${STATUS_CHIP[r.status] || ''}">${r.status}</span></td><td class="r num"><b>${money(r.status === 'Approved' ? r.amountCents : 0)}</b></td><td class="muted">${r.notes}${r.status === 'Approved' ? html`<span class="sub" style="color:var(--ok)">Approved ${dateOnly(r.approvedOn)}. ${r.approvalEvidence}</span>` : ''}</td>${acts('supplements', r.id, edit)}</tr>`)}
      </tbody><tfoot><tr><td colspan="3">Totals</td><td class="r num">${money(totalReq)}</td><td></td><td class="r num">${money(s.approvedSupplementsCents)}</td><td></td>${edit ? html`<td></td>` : ''}</tr></tfoot></table>`
      : emptyBlock('No supplements or change orders', 'Nothing has been requested. Only supplements with the status Approved ever change the project budget.');
    return html`<div class="stack" style="--gap:16px">${tableCard('Supplements & change orders', 'Only “Approved” supplements increase the budget. Drafts and submissions never do.', addBtn('supplements', 'Add supplement', edit), table, edit)}</div>`;
  }

  function drawsTab(b, edit) {
    const t = b.tracker, s = t.summary;
    const card = (d) => {
      const m = Math.max(d.amountRequestedCents, d.amountApprovedCents || 0, 1); const w = (v) => (((v || 0) / m) * 100).toFixed(1);
      return html`<article class="card"><div class="row wrap-r" style="justify-content:space-between;align-items:flex-start"><div><div class="row wrap-r" style="gap:10px"><span class="code">${d.drawRef}</span><span class="chip ${STATUS_CHIP[d.status] || ''}">${d.status}</span></div><h3 style="margin:12px 0 4px">${d.purpose}</h3><div class="muted" style="font-size:.875rem">${d.requestedOn ? 'Requested ' + dateOnly(d.requestedOn) : 'Not yet submitted to the lender'}</div></div>
        ${edit ? html`<div class="row-actions no-print"><button class="icon-btn" data-act="edit" data-entity="draws" data-id="${d.id}" aria-label="Edit" title="Edit">${raw(icons.edit)}</button><button class="icon-btn danger" data-act="delete" data-entity="draws" data-id="${d.id}" aria-label="Delete" title="Delete">${raw(icons.trash)}</button></div>` : ''}</div>
        <div class="funnel" style="margin-top:22px"><div class="f req"><span>Requested</span><div class="track"><i style="width:${w(d.amountRequestedCents)}%"></i></div><span class="amt num">${money(d.amountRequestedCents)}</span></div>
          <div class="f app"><span>Approved</span><div class="track"><i style="width:${w(d.amountApprovedCents)}%"></i></div><span class="amt num">${d.amountApprovedCents == null ? 'Not yet approved' : money(d.amountApprovedCents)}</span></div>
          <div class="f dis"><span>Disbursed</span><div class="track"><i style="width:${w(d.amountDisbursedCents)}%"></i></div><span class="amt num">${d.amountDisbursedCents == null ? 'Nothing paid out' : money(d.amountDisbursedCents)}</span></div></div>
        ${d.notes ? html`<p class="muted" style="margin:18px 0 0">${d.notes}</p>` : ''}<div style="margin-top:12px">${attachCell(t, 'draw', d.id, edit)}</div></article>`;
    };
    return html`<div class="stack" style="--gap:16px"><div class="row wrap-r" style="justify-content:space-between"><div><h3 class="h3" style="font-family:var(--serif)">Funding draw requests</h3><div class="muted" style="font-size:.875rem;margin-top:4px">Requested, approved and disbursed are separate facts. Approved and disbursed stay empty until the lender confirms them.</div></div>${addBtn('draws', 'Add draw request', edit)}</div>
      <div class="grid cols-3"><div class="kpi"><div class="k">Total requested</div><div class="v num">${money(s.draws.requestedCents)}</div></div><div class="kpi"><div class="k">Total approved</div><div class="v num">${money(s.draws.approvedCents)}</div></div><div class="kpi"><div class="k">Total disbursed</div><div class="v num">${money(s.draws.disbursedCents)}</div></div></div>
      ${t.draws.length ? t.draws.map(card) : html`<section class="card">${emptyBlock('No draw requests', 'No funding has been requested yet.')}</section>`}</div>`;
  }

  function contractTab(b, edit) {
    const p = b.project, t = b.tracker, s = t.summary;
    const items = [
      ['Base total renovation estimate', s.baseEstimateCents, 'The total estimate for the project.' + (p.estimateSource ? ' ' + p.estimateSource + '.' : ''), true],
      ['Initial Phase 1 materials allowance', s.phase1TotalCents, 'See the Phase 1 Budget itemization.'],
      ['Remaining base contract amount', s.remainingBaseCents, 'Not yet allocated by trade. Does not mean an unpaid balance.'],
      ['Approved supplement amount', s.approvedSupplementsCents, 'Only approved supplements count.'],
      ['Revised estimated job budget', s.revisedBudgetCents, 'Base estimate plus approved supplements.', true],
      ['Documented expenses entered', s.expensesCents, 'Payments entered in the Expense Log only.'],
      ['Funding actually disbursed', s.draws.disbursedCents, 'From Draw Requests: the amount paid out, not the amount requested.'],
      ['Budget less recorded expenses', s.budgetLessExpensesCents, 'A budget calculation, not a bank balance.']
    ];
    const rem = t.remaining; const docs = t.documents || [];
    return html`<div class="stack" style="--gap:16px">
      ${tableCard('Contract estimate · project cost & draw plan', `${p.clientName} · ${p.address || ''} · ${p.contractor}`, '', html`<table class="t"><thead><tr><th>Financial item</th><th class="r">Amount</th><th>Basis / verification</th></tr></thead><tbody>
        ${items.map(([k, v, note, strong]) => html`<tr><td>${strong ? html`<b>${k}</b>` : k}</td><td class="r num">${strong ? html`<b>${money(v)}</b>` : money(v)}</td><td class="muted">${note}</td></tr>`)}
        <tr><td>Initial draw / original total</td><td class="r num">${pct(s.initialDrawShare)}</td><td class="muted">A ratio, not evidence of lender approval.</td></tr></tbody></table>`, edit)}
      ${tableCard('Remaining contract amount · breakdown by trade', 'Entered as written quotes or signed scopes are received.', addBtn('remaining-items', 'Add item', edit), html`${rem.length ? html`<table class="t"><thead><tr><th>Category / trade</th><th class="r">Amount</th><th>Source / note</th>${actTh(edit)}</tr></thead><tbody>${rem.map((r) => html`<tr><td><b>${r.category}</b></td><td class="r num">${money(r.amountCents)}</td><td class="muted">${r.note}</td>${acts('remaining-items', r.id, edit)}</tr>`)}</tbody>` : html`<table class="t"><tbody><tr><td colspan="3">${emptyBlock('No trade-by-trade breakdown yet', 'Labor and trade costs are listed here once quotes or signed scopes are received.')}</td></tr></tbody>`}
        <tfoot><tr><td>Total remaining amount itemized</td><td class="r num">${money(s.itemizedRemainingCents)}</td><td></td>${edit && rem.length ? html`<td></td>` : ''}</tr><tr><td>Balance still to itemize</td><td class="r num">${money(s.balanceToItemizeCents)}</td><td></td>${edit && rem.length ? html`<td></td>` : ''}</tr></tfoot></table>`, edit)}
      <section class="card pad-0"><div class="card-head"><div><h3>Project documents</h3><div class="muted" style="font-size:.875rem;margin-top:4px">Receipts and supporting documents. Files are private and only downloadable by people assigned to this project.</div></div>${edit ? html`<button class="btn gold sm no-print" data-act="upload">${raw(icons.upload)} Upload document</button>` : ''}</div>
        ${docs.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Document</th><th>Type</th><th>Attached to</th><th>Size</th><th>Added</th><th></th></tr></thead><tbody>${docs.map((d) => {
          const target = d.linkedType === 'expense' ? t.expenses.find((x) => x.id === d.linkedId) : d.linkedType === 'supplement' ? t.supplements.find((x) => x.id === d.linkedId) : d.linkedType === 'draw' ? t.draws.find((x) => x.id === d.linkedId) : null;
          const ref = target ? (target.expenseRef || target.supplementRef || target.drawRef) : '';
          return html`<tr><td><b>${d.title}</b><span class="sub">${d.fileName}</span></td><td><span class="chip">${KIND[d.kind] || d.kind}</span></td><td>${ref ? html`<span class="code">${ref}</span>` : html`<span class="faint">Project</span>`}</td><td class="num">${fileSize(d.sizeBytes)}</td><td class="num" style="white-space:nowrap">${window.FCV.dateTime(d.uploadedAt)}</td><td class="r"><div class="row-actions"><a class="btn sm" href="/api/documents/${d.id}/download" download>${raw(icons.download)} Download</a>${edit ? html`<button class="icon-btn danger no-print" data-act="doc-delete" data-id="${d.id}" aria-label="Delete document" title="Delete document">${raw(icons.trash)}</button>` : ''}</div></td></tr>`;
        })}</tbody></table></div>` : emptyBlock('No documents yet', 'Receipts and supporting documents will appear here when they are added.')}</section></div>`;
  }

  const RENDER = { summary: summaryTab, budget: budgetTab, expenses: expensesTab, supplements: supplementsTab, draws: drawsTab, contract: contractTab };

  /* -------------------------------------------------------------- page assembly */
  const stepper = (stage) => {
    if (stage === 'declined') return '';
    const idx = STEPS.findIndex((x) => x[0] === stage);
    return html`<ol class="stepper" aria-label="Progress">${STEPS.map(([k, label], i) => html`<li class="step ${i < idx ? 'done' : i === idx ? 'now' : ''}" ${i === idx ? raw('aria-current="step"') : ''}><div class="node">${i < idx ? raw(icons.check) : i + 1}</div><div class="lab">${label}</div></li>`)}</ol>`;
  };

  function overview(b) {
    const p = b.project; const [title, text] = STAGE_TEXT[p.stage] || ['', ''];
    const closed = p.stage === 'declined';
    return html`<section class="card gold-edge"><div class="row wrap-r" style="justify-content:space-between;align-items:flex-start;gap:20px"><div style="max-width:60ch"><div class="eyebrow">Current status</div><h2 class="h2" style="margin-top:10px">${title}</h2><p class="muted" style="margin:10px 0 0">${text}</p></div>
        <div class="grid cols-2" style="min-width:min(100%,340px);flex:1;max-width:460px"><div class="kpi"><div class="k">${p.stage === 'new' || p.stage === 'contacted' || p.stage === 'site_visit' ? 'Quote' : 'Your quote'}</div><div class="v num" style="font-size:1.55rem">${p.baseEstimateCents != null ? money(p.baseEstimateCents) : 'Not ready yet'}</div></div>
          <div class="kpi"><div class="k">Work can start from</div><div class="v" style="font-size:1.35rem">${p.workStartDate ? dateOnly(p.workStartDate) : 'To be confirmed'}</div></div></div></div>
      ${closed ? '' : html`<div style="margin-top:34px">${stepper(p.stage)}</div>`}
      ${p.clientMessage ? html`<div class="callout" style="margin-top:26px"><span>${raw(icons.mail)}</span><p><b>A note from FCV</b><br>${p.clientMessage}</p></div>` : ''}</section>`;
  }

  FCV_tracker();
  function FCV_tracker() {
    window.FCV.tracker = {
      TABS, STEPS, STAGE_TEXT,
      /** The whole project page. `opts.admin` adds edit controls; `opts.coverActions` is extra HTML for the cover. */
      page(bundle, opts) {
        const { tab = 'summary', admin = false, coverActions = '', backHref = '/portal/#/', backLabel = 'My requests' } = opts || {};
        const p = bundle.project; const t = bundle.tracker; const edit = !!(admin && bundle.permissions && bundle.permissions.canEdit);
        const visible = !!t;
        const body = visible ? html`<div class="stack" style="--gap:20px">
            <div class="row wrap-r no-print" style="justify-content:space-between"><div class="tabs" role="tablist" aria-label="Project tracker">${TABS.map(([k, label]) => html`<button class="tab" role="tab" id="tab-${k}" aria-selected="${String(k === tab)}" aria-controls="panel" data-tab="${k}">${label}${k === 'expenses' && t.expenses.length ? html`<span class="count">${t.expenses.length}</span>` : ''}${k === 'supplements' && t.supplements.length ? html`<span class="count">${t.supplements.length}</span>` : ''}${k === 'draws' && t.draws.length ? html`<span class="count">${t.draws.length}</span>` : ''}</button>`)}</div></div>
            <div id="panel" class="tabpanel" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="0">${(RENDER[tab] || summaryTab)(bundle, edit)}</div></div>`
          : html`<section class="card" style="text-align:center;padding:48px 24px">${raw(icons.lock.replace('<svg', '<svg style="width:40px;height:40px;color:var(--gold)"'))}<h2 class="h2" style="margin:14px 0 8px">Your project tracker opens when work begins</h2><p class="muted" style="max-width:56ch;margin:0 auto">Costs, funding draws, receipts and change orders will appear here as FCV records them, so you can follow every step. You will see exactly what has been requested, approved and paid.</p></section>`;
        return html`<div class="stack" style="--gap:22px"><div>
          <section class="cover"><a class="crumb no-print" href="${backHref}">${raw(icons.back)} ${backLabel}</a>
            <div class="row wrap-r" style="justify-content:space-between;align-items:flex-end;gap:20px"><div style="min-width:0"><div class="eyebrow">${p.clientName}</div><h1 class="display" style="margin-top:12px">${p.title}</h1>
              <div class="meta"><span class="code">${p.code}</span>${p.address ? html`<span class="muted">${p.address}</span>` : ''}${p.lenderStatus ? html`<span class="chip gold">${p.lenderStatus}</span>` : ''}${p.phaseLabel ? html`<span class="chip">${p.phaseLabel}</span>` : ''}</div></div>
              <div class="row wrap-r no-print">${coverActions}${visible ? html`<button class="btn sm" data-act="print">${raw(icons.print)} Print / save PDF</button>` : ''}</div></div></section></div>
          ${overview(bundle)}${body}</div>`;
      }
    };
  }
})();
