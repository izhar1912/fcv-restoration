/* ============================================================================
   FCV Restoration & Construction — shared form handler
   ----------------------------------------------------------------------------
   Used by contact.html and pricing.html.

   1. Deploy Code.gs as a Google Apps Script Web App (see SETUP-GUIDE.md).
   2. Paste the Web App URL (ends in /exec) into ENDPOINT below.
   That is the only place the URL needs to live.
   ========================================================================== */
(function () {
  'use strict';

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbwSUS7w2A_L6hVyHHHtgnqJybocrzB4w5mfkJCUP92ud7lzKae6n6dODItDAEqF0AL5/exec';
  var THANK_YOU_PAGE = 'thank-you.html';
  var TIMEOUT_MS = 30000; // Apps Script writes the row AND sends 2 emails before it answers

  function isConfigured() {
    return /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(ENDPOINT);
  }

  /**
   * Sends a submission to the Google Sheet / email backend, then redirects the
   * visitor to the thank-you page. Rejects if the request cannot be sent, so
   * callers can show an error and let the visitor try again.
   */
  function send(formType, payload) {
    if (!isConfigured()) {
      console.error('[FCV forms] ENDPOINT is not set. Paste your Apps Script Web App URL into forms.js.');
      return Promise.reject(new Error('Form endpoint not configured'));
    }

    var body = {};
    Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
    body.formType = formType;
    body.submittedAt = body.submittedAt || new Date().toISOString();
    body.pageUrl = body.pageUrl || window.location.href;

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    // Apps Script web apps do not send CORS headers, so this is a "no-cors"
    // POST (the response is opaque). text/plain keeps it a "simple" request.
    return fetch(ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function () {
      if (timer) clearTimeout(timer);
      window.location.href = THANK_YOU_PAGE + '?form=' + encodeURIComponent(formType);
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /* ---------------------------------------------------------------------------
     Contact form (contact.html)
     - Runs in the capture phase so Webflow's own form handler never sees the
       submit (it would otherwise try to post to Webflow and show its fail box).
     - Validates by itself and ALWAYS tells the visitor what is wrong. (The
       browser's built-in validation can't be used: the terms checkbox is
       visually hidden, so the browser blocks the submit with no visible hint.)
     ------------------------------------------------------------------------ */
  window.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.getAttribute('data-fcv-form') !== 'contact') return;

    e.preventDefault();
    e.stopImmediatePropagation();

    var btn = form.querySelector('input[type="submit"]');
    var status = form.parentNode.querySelector('.fcv-form-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'fcv-form-status';
      status.setAttribute('role', 'alert');
      status.style.cssText = 'margin-top:1rem;font-size:1rem;line-height:1.5;font-weight:600;color:#b3261e;';
      form.parentNode.appendChild(status);
    }
    status.textContent = '';

    function val(name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? String(el.value || '').trim() : '';
    }
    function problem(msg, fieldName) {
      status.textContent = msg;
      var el = fieldName ? form.querySelector('[name="' + fieldName + '"]') : null;
      try { if (el && el.type !== 'checkbox') el.focus(); } catch (err) {}
      try { status.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {}
    }

    // Anti-spam trap field: real visitors never see or fill it.
    var trap = form.querySelector('[name="hp_x7q"]');
    if (trap && trap.value) { console.warn('[FCV forms] submission ignored (trap field filled)'); return; }

    var email = val('Email');
    var phoneDigits = val('Phone-number').replace(/\D/g, '');
    var terms = form.querySelector('[name="checkbox"]');

    if (!val('name'))                                       return problem('Please enter your name.', 'name');
    if (phoneDigits.length < 10)                            return problem('Please enter a phone number we can reach you on.', 'Phone-number');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))      return problem('Please enter a valid email address.', 'Email');
    if (terms && !terms.checked)                            return problem('Please tick the box to agree to the terms and conditions.');

    var originalLabel = btn ? btn.value : '';
    if (btn) { btn.disabled = true; btn.value = btn.getAttribute('data-wait') || 'Please wait...'; }
    console.info('[FCV forms] sending contact form...');

    send('contact', {
      name: val('name'),
      phone: val('Phone-number'),
      email: email,
      subject: val('Subject') || 'General enquiry',
      message: val('Message')
    }).catch(function (err) {
      console.error('[FCV forms] send failed:', err);
      problem('Something went wrong sending that. Please call (313) 293-2280 or email quote@fcvrestoration.com and we\u2019ll help right away.');
      if (btn) { btn.disabled = false; btn.value = originalLabel; }
    });
  }, true);

  window.FCVForms = { send: send, isConfigured: isConfigured };
})();
