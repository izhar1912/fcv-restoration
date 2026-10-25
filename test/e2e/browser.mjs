import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function launch() { return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell' }); }
export async function newPage(browser, { w = 1366, h = 900, base = 'http://localhost:8765' } = {}) {
  const p = await browser.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  p.errors = []; p.on('pageerror', (e) => p.errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|ERR_NAME|Failed to load resource/.test(m.text())) p.errors.push('console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
  await p.setRequestInterception(true);
  p.on('request', (r) => { const u = r.url(); if (u.startsWith(base) || u.startsWith('data:')) r.continue(); else r.abort(); });
  p.base = base; return p;
}
export async function signIn(p, email, pw, path = '/portal/') {
  await p.goto(p.base + path, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-login]', { timeout: 8000 });
  await p.type('input[name=email]', email); await p.type('input[name=password]', pw);
  await p.click('[data-login] button[type=submit]'); await p.waitForSelector('#view', { timeout: 8000 }); await wait(500);
}
