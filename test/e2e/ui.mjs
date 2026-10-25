// TEST ONLY: drives the real pages in headless Chromium against the dev server (real API + PGlite + fake Identity).
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
import { startDevServer, PASSWORDS } from './dev-server.mjs';
const OUT = process.env.SHOTS || '/tmp/claude-0/shots';
const s = await startDevServer({ port: 8765 });
const browser = await chromium.launch();
const results = []; const ok = (n, c, d = '') => { results.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
async function page(ctx, w = 1366, h = 900) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: h }); p.errs = [];
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource|ERR_/.test(m.text())) p.errs.push('console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
  await p.route('**/*', (r) => (/localhost:8765|^data:/.test(r.request().url()) ? r.continue() : r.abort()));
  return p;
}
async function login(p, email, path) {
  await p.goto('http://localhost:8765' + path); await p.waitForSelector('[data-login]');
  await p.fill('input[name=email]', email); await p.fill('input[name=password]', PASSWORDS[email]); await p.click('[data-login] button[type=submit]'); await p.waitForSelector('#view'); await p.waitForTimeout(600);
}
const shot = (p, n, full = true) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });
try {
  // login screen
  const c0 = await browser.newContext(); const p0 = await page(c0); await p0.goto('http://localhost:8765/portal/'); await p0.waitForSelector('[data-login]'); await shot(p0, '01-login', false);
  await p0.fill('input[name=email]', 'maria@client.test'); await p0.fill('input[name=password]', 'wrong'); await p0.click('[data-login] button[type=submit]'); await p0.waitForSelector('.form-error'); ok('wrong password shows an error', true);
  // member
  const c1 = await browser.newContext(); const m = await page(c1); await login(m, 'maria@client.test', '/portal/');
  await shot(m, '02-member-list'); ok('member sees only assigned projects', (await m.$$('.proj')).length >= 2, 'cards');
  const txt = await m.textContent('body'); ok('member list hides admin links', !/Administration/.test(await m.textContent('#profileMenu')));
  await m.click('.avatar-btn'); await m.waitForTimeout(200); await shot(m, '03-member-menu', false); await m.keyboard.press('Escape');
  await m.click('.proj:has-text("Kitchen")'); await m.waitForSelector('.stepper'); await m.waitForTimeout(400); await shot(m, '04-member-summary');
  ok('stepper shows Work in progress', /Work in progress/.test(await m.textContent('.stepper')));
  for (const [k, n] of [['budget', '05'], ['expenses', '06'], ['supplements', '07'], ['draws', '08'], ['contract', '09']]) { await m.click(`[data-tab=${k}]`); await m.waitForTimeout(250); await shot(m, `${n}-member-${k}`); }
  ok('member has no edit controls', (await m.$$('[data-act=add],[data-act=edit],[data-act=delete]')).length === 0);
  const adminTry = await m.evaluate(async () => (await fetch('/api/admin/users')).status); ok('member blocked from admin API (403)', adminTry === 403, adminTry);
  await m.goto('http://localhost:8765/admin/'); await m.waitForSelector('.auth, #view'); await m.waitForTimeout(500); ok('member sees "Administrators only" on /admin', /Administrators only/.test(await m.textContent('body')));
  // admin
  const c2 = await browser.newContext(); const a = await page(c2); await login(a, 'owner@fcv.test', '/admin/');
  await shot(a, '10-admin-projects'); ok('admin project list', (await a.$$('[data-open]')).length >= 3);
  await a.click('[data-open]:has-text("Kitchen")'); await a.waitForSelector('.stepper'); await a.waitForTimeout(400); await shot(a, '11-admin-project');
  ok('admin has edit controls', (await a.$$('[data-act=settings]')).length === 1);
  await a.click('[data-tab=expenses]'); await a.waitForTimeout(200); await a.click('[data-act=add][data-entity=expenses]'); await a.waitForSelector('.drawer form'); await a.waitForTimeout(600); await shot(a, '12-admin-add-expense', false);
  await a.click('.drawer [data-save]'); await a.waitForSelector('.drawer .has-error'); ok('validation errors show inline', true);
  await a.fill('.drawer [name=vendor]', 'Test Hardware'); await a.fill('.drawer [name=purchasedOn]', '2026-10-15'); await a.fill('.drawer [name=description]', 'Fasteners'); await a.fill('.drawer [name=amountCents]', '45.50');
  await a.click('.drawer [data-save]'); await a.waitForSelector('.toast'); await a.waitForTimeout(500); ok('expense added and listed', /Test Hardware/.test(await a.textContent('#panel')) && /45\.50/.test(await a.textContent('#panel')));
  await a.click('[data-tab=draws]'); await a.waitForTimeout(200); await a.click('[data-act=add][data-entity=draws]'); await a.waitForSelector('.drawer form');
  await a.fill('.drawer [name=purpose]', 'Trim'); await a.fill('.drawer [name=amountRequestedCents]', '500'); await a.selectOption('.drawer [name=status]', 'Funded'); await a.fill('.drawer [name=requestedOn]', '2026-10-16'); await a.fill('.drawer [name=amountApprovedCents]', '500'); await a.fill('.drawer [name=amountDisbursedCents]', '100');
  await a.click('.drawer [data-save]'); await a.waitForSelector('.drawer .has-error .err:not([hidden])'); await a.waitForFunction(() => /Funded means/.test(document.querySelector('.drawer').textContent), null, { timeout: 5000 }).catch(() => {}); ok('draw business rule error surfaced', /Funded means/.test(await a.textContent('.drawer')));
  await a.selectOption('.drawer [name=status]', 'Submitted'); await a.click('.drawer [data-save]'); await a.waitForTimeout(700); ok('draw saved after correction', /Trim/.test(await a.textContent('#panel')));
  await a.click('[data-act=settings]'); await a.waitForSelector('.drawer form'); await a.waitForTimeout(600); await shot(a, '13-admin-settings', false); await a.selectOption('.drawer [name=stage]', 'completed'); await a.click('.drawer [data-save]'); await a.waitForTimeout(800);
  ok('stage change saved', /Your project is complete/.test(await a.textContent('body')));
  await a.goto('http://localhost:8765/admin/#/requests'); await a.waitForSelector('[data-ref]'); await a.waitForTimeout(300); await shot(a, '14-admin-requests'); await a.click('[data-ref]:first-child'); await a.waitForSelector('.drawer form'); await a.waitForTimeout(600); await shot(a, '15-admin-request-detail', false); await a.keyboard.press('Escape');
  await a.goto('http://localhost:8765/admin/#/people'); await a.waitForSelector('.t'); await a.click('[data-health]'); await a.waitForSelector('.health'); await a.waitForTimeout(800); await shot(a, '16-admin-people');
  await a.goto('http://localhost:8765/admin/#/audit'); await a.waitForSelector('.audit-item'); await shot(a, '17-admin-audit');
  await a.goto('http://localhost:8765/admin/#/import'); await a.waitForSelector('#drop'); await a.setInputFiles('#file', '/mnt/user-data/uploads/FCV_Medinah_Taiwo_Member_Portal_Admin_Tracker_37582-89.xlsx'); await a.waitForSelector('[data-commit]'); await a.waitForTimeout(300); await shot(a, '18-admin-import');
  ok('import preview shows checks passing', (await a.$$('.health.ok')).length >= 1 && (await a.$$('.health.bad')).length === 0);
  // mobile
  const c3 = await browser.newContext(); const mm = await page(c3, 390, 844); await login(mm, 'maria@client.test', '/portal/'); await shot(mm, '19-mobile-list'); await mm.click('.proj:has-text("Kitchen")'); await mm.waitForSelector('.stepper'); await mm.waitForTimeout(300); await shot(mm, '20-mobile-project'); await mm.click('[data-tab=draws]'); await mm.waitForTimeout(300); await shot(mm, '21-mobile-draws');
  const overflow = await mm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok('no horizontal page scroll on phone', overflow <= 1, overflow);
  for (const [n, p] of [['member', m], ['admin', a], ['mobile', mm], ['login', p0]]) ok(`no console errors (${n})`, p.errs.length === 0, p.errs.join(' | '));
} catch (e) { console.error('ERROR', e); ok('script completed', false, e.message); }
await browser.close(); await s.close();
const bad = results.filter((r) => !r[1]).length; console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
