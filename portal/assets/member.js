/* FCV portal: the client / lender view. Read-only. */
(function () {
  'use strict';
  const { html, raw, mount, api, money, icons, dateOnly, ago } = window.FCV;
  const STEP_KEYS = window.FCV.tracker.STEPS.map((s) => s[0]);
  const STAGE_LABEL = Object.fromEntries(window.FCV.tracker.STEPS); STAGE_LABEL.declined = 'Closed';
  const first = (me) => { const n = (me.name || me.email.split('@')[0]).split(/[\s._-]+/)[0]; return n.charAt(0).toUpperCase() + n.slice(1); };

  const skeleton = () => html`<div class="stack" style="--gap:18px"><div class="skel" style="height:150px"></div><div class="skel" style="height:260px"></div></div>`;

  function card(p) {
    const idx = STEP_KEYS.indexOf(p.stage);
    const s = p.summary;
    const nums = s
      ? [['Total estimate', money(s.baseEstimateCents)], ['Draw requested', money(s.draws.requestedCents)], ['Disbursed', money(s.draws.disbursedCents)]]
      : [['Quote', p.baseEstimateCents != null ? money(p.baseEstimateCents) : 'Not ready'], ['Work can start', p.workStartDate ? dateOnly(p.workStartDate) : 'To be confirmed'], ['Updated', ago(p.updatedAt)]];
    return html`<a class="proj" href="#/p/${p.id}"><div class="row wrap-r" style="justify-content:space-between"><span class="code">${p.code}</span><span class="chip ${p.stage === 'declined' ? 'dim' : 'gold'}"><span class="dot"></span>${STAGE_LABEL[p.stage] || p.stage}</span></div>
      <h3>${p.title}</h3><div class="addr">${p.address || p.clientName}</div>
      <div class="mini" aria-hidden="true">${STEP_KEYS.map((k, i) => html`<i class="${i <= idx ? 'on' : ''}"></i>`)}</div>
      <div class="nums">${nums.map(([k, v]) => html`<div><b class="num">${v}</b><span>${k}</span></div>`)}</div>
      <div class="go"><span>${s ? 'Open project tracker' : 'View details'}</span>${raw(icons.arrow)}</div></a>`;
  }

  async function showList(view, me) {
    document.title = 'My requests · FCV Client & Lender Portal';
    mount(view, html`<div class="stack" style="--gap:26px"><div><div class="eyebrow">Your projects</div><h1 class="display" style="margin-top:12px">Welcome back, ${first(me)}.</h1><p class="lead" style="margin-top:12px">Everything below is a read-only view of your project, kept up to date by FCV Restoration &amp; Construction.</p></div>${skeleton()}</div>`);
    let list;
    try { list = (await api('GET', '/api/projects')).projects; }
    catch (e) { mount(view, html`<div class="callout bad"><span>${raw(icons.alert)}</span><p><b>We couldn’t load your projects.</b><br>${e.message} <button class="link-btn" data-retry>Try again</button></p></div>`); view.querySelector('[data-retry]').onclick = () => showList(view, me); return; }
    mount(view, html`<div class="stack" style="--gap:28px"><div><div class="eyebrow">Your projects</div><h1 class="display" style="margin-top:12px">Welcome back, ${first(me)}.</h1><p class="lead" style="margin-top:12px">Everything below is a read-only view of your project, kept up to date by FCV Restoration &amp; Construction.</p></div>
      ${list.length ? html`<div class="proj-grid">${list.map(card)}</div>` : html`<section class="card" style="text-align:center;padding:56px 24px">${raw(icons.building.replace('<svg', '<svg style="width:46px;height:46px;color:var(--gold)"'))}<h2 class="h2" style="margin:16px 0 8px">No projects are linked to your account yet</h2><p class="muted" style="max-width:54ch;margin:0 auto 22px">If you were expecting to see a project here, please contact FCV and we’ll connect it to your account.</p><div class="row wrap-r" style="justify-content:center"><a class="btn gold" href="tel:+13132932280">${raw(icons.phone)} (313) 293-2280</a><a class="btn" href="mailto:quote@fcvrestoration.com">${raw(icons.mail)} Email FCV</a></div></section>`}</div>`);
  }

  async function showProject(view, id, tab) {
    mount(view, skeleton());
    let bundle;
    try { bundle = await api('GET', `/api/projects/${encodeURIComponent(id)}`); }
    catch (e) {
      mount(view, html`<section class="card" style="text-align:center;padding:56px 24px"><h2 class="h2">${e.status === 404 ? 'We couldn’t find that project' : 'We couldn’t load that project'}</h2><p class="muted" style="margin:10px 0 22px">${e.status === 404 ? 'It may not be linked to your account.' : e.message}</p><a class="btn gold" href="#/">${raw(icons.back)} Back to my requests</a></section>`); return;
    }
    const p = bundle.project; document.title = `${p.title} · FCV Client & Lender Portal`;
    const draw = () => {
      mount(view, window.FCV.tracker.page(bundle, { tab, admin: false }));
      view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', `#/p/${id}/${tab}`); draw(); const t = view.querySelector('#tab-' + tab); if (t) t.focus(); }));
      const pr = view.querySelector('[data-act=print]'); if (pr) pr.onclick = () => window.print();
      view.querySelector('.tabs') && view.querySelector('.tabs').addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; const keys = window.FCV.tracker.TABS.map((t) => t[0]); let i = keys.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1); i = (i + keys.length) % keys.length;
        tab = keys[i]; history.replaceState(null, '', `#/p/${id}/${tab}`); draw(); view.querySelector('#tab-' + tab).focus();
      });
    };
    draw(); window.scrollTo({ top: 0 });
  }

  window.FCV.start({
    area: 'member',
    async onReady({ me, view }) {
      const render = () => { const [seg, id, tab] = window.FCV.route(); return seg === 'p' && id ? showProject(view, id, tab || 'summary') : showList(view, me); };
      window.FCV.onRoute(render); await render();
    }
  });
})();
