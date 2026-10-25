/**
 * ============================================================================
 *  FCV Restoration & Construction — Forms backend (Google Apps Script)
 * ============================================================================
 *  What this does, every time someone submits the Contact form or the
 *  Pricing / quote form on the website:
 *
 *    1. Saves the submission as a new row in this Google Sheet
 *       (tabs: "Quote Requests" and "Contact Messages"), each with the two
 *       extra columns  ->  Quote Status  and  Actual Price.
 *    2. Emails the visitor a branded confirmation  (sent from the Google
 *       account that owns this script — fcvsupport@gmail.com).
 *    3. Emails the team a different, internal notification at
 *       fcvsupport@gmail.com and quote@fcvrestoration.com.
 *
 *  The website itself redirects the visitor to thank-you.html (that part lives
 *  in forms.js, not here).
 *
 *  SETUP: see SETUP-GUIDE.md. Short version:
 *    - Sign in as fcvsupport@gmail.com, create a Google Sheet.
 *    - Extensions > Apps Script, paste this whole file, save.
 *    - Run setup() once and approve the permissions.
 *    - Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 *    - Copy the /exec URL into forms.js.
 * ============================================================================
 */

var CONFIG = {
  COMPANY_NAME:  'FCV Restoration & Construction',
  SENDER_NAME:   'FCV Restoration & Construction',

  // The Google account that DEPLOYS this script is the one emails are sent
  // from. It must be this address (used only for a safety check/log message).
  SENDER_EMAIL:  'fcvsupport@gmail.com',

  // Internal notification goes to all of these.
  COMPANY_RECIPIENTS: ['fcvsupport@gmail.com', 'quote@fcvrestoration.com'],

  // Where a customer's "Reply" goes when they answer their confirmation email.
  CUSTOMER_REPLY_TO: 'quote@fcvrestoration.com',

  PHONE_DISPLAY: '(313) 293-2280',
  PHONE_TEL:     '+13132932280',
  PUBLIC_EMAIL:  'quote@fcvrestoration.com',
  ADDRESS:       '570 Lake Cook Rd Ste 300, Deerfield, Illinois 60015',

  // Optional: your live website address, e.g. 'https://www.fcvrestoration.com'
  // When set, a "Visit our website" link is added to the customer email.
  WEBSITE_URL:   '',

  TIMEZONE:      'America/Chicago',

  QUOTE_SHEET:   'Quote Requests',
  CONTACT_SHEET: 'Contact Messages',

  // Options in the "Quote Status" dropdown. The first one is used for new rows.
  STATUS_OPTIONS: ['New', 'Contacted', 'Site Visit Scheduled', 'Quote Sent', 'Accepted', 'Work in Progress', 'Declined', 'Completed'],

  // Leave empty when this script was created from inside the Google Sheet
  // (Extensions > Apps Script). Only fill in for a standalone script.
  SPREADSHEET_ID: '',

  // ---- Admin dashboard (admin.html) ----
  // Optional: full web address of admin.html once it is online, e.g.
  // 'https://www.fcvrestoration.com/admin.html'. When set, the team email gets an
  // "Open in dashboard" button that opens that exact request.
  ADMIN_URL: '',
  ADMIN_SESSION_HOURS: 12,      // how long one sign-in lasts
  ADMIN_MAX_FAILS: 6,           // wrong passwords allowed before a temporary lock
  ADMIN_LOCK_MINUTES: 15,       // how long that lock lasts

  // ---- Customer tracking page (track.html) ----
  // Full web address of track.html once it is online, for example
  // 'https://www.fcvrestoration.com/track.html'. When set, every quote
  // confirmation email contains a private "View my request" link.
  // (If you filled in WEBSITE_URL above, '/track.html' is added to it automatically.)
  TRACK_URL: '',
  // Customers only see the Actual Price once their status is one of these.
  // Until then they see "we'll confirm your price after the site visit".
  PRICE_VISIBLE_STATUSES: ['Quote Sent', 'Accepted', 'Work in Progress', 'Completed']
};

var BRAND = {
  NAVY:  '#0D1B2A',
  NAVY2: '#16283B',
  GOLD:  '#F3B41E',
  SAND:  '#ECE7D9',
  PAPER: '#F4F1EA',
  INK:   '#1F2937',
  MUTED: '#6B7280',
  LINE:  '#E6E1D3'
};

/* ----------------------------- sheet layout ------------------------------ */

// [header, number format]. Quote Status and Actual Price are the last two.
var QUOTE_COLUMNS = [
  ['Reference', '@'], ['Submitted At', 'yyyy-mm-dd hh:mm'], ['Name', '@'], ['Phone', '@'], ['Email', '@'],
  ['Best Time to Reach', '@'], ['Property Address', '@'], ['City', '@'], ['ZIP', '@'],
  ['Property Type', '@'], ['Finish Level', '@'], ['Start Timeline', '@'], ['Insurance Claim', '@'],
  ['Notes', '@'], ['Selected Items', '@'], ['Site-Visit Items', '@'], ['Item Count', '0'],
  ['Estimate Low', '$#,##0'], ['Estimate High', '$#,##0'], ['Estimate Range (shown to customer)', '@'],
  ['Page URL', '@'],
  ['Quote Status', '@'], ['Actual Price', '$#,##0.00'], ['Internal Notes', '@'],
  ['Work Start Date', '@'], ['Client Message', '@'], ['Tracking Token', '@']
];

var CONTACT_COLUMNS = [
  ['Reference', '@'], ['Submitted At', 'yyyy-mm-dd hh:mm'], ['Name', '@'], ['Phone', '@'], ['Email', '@'],
  ['Subject', '@'], ['Message', '@'], ['Page URL', '@'],
  ['Quote Status', '@'], ['Actual Price', '$#,##0.00'], ['Internal Notes', '@']
];

var LOGO_B64 = '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';

/* ------------------------------ entry points ----------------------------- */

function doGet() {
  return json_({ ok: true, service: 'FCV forms endpoint', time: new Date().toISOString() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    if (data.action) return json_(handleAdmin_(data));          // admin dashboard calls

    if (data.companyUrl) return json_({ ok: true });            // honeypot: pretend success

    var result = handleSubmission_(data, lock);
    return json_({ ok: true, ref: result.ref });
  } catch (err) {
    console.error('doPost failed: ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Does the real work. Shared by doPost() and the test functions. */
function handleSubmission_(data, lock) {
  var type = data.formType === 'contact' ? 'contact' : 'quote';
  var d = type === 'contact' ? cleanContact_(data) : cleanQuote_(data);

  var ss = getSpreadsheet_();
  var sheet = ensureSheet_(ss, type);

  var ref, row;
  lock = lock || LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ref = nextReference_(type);
    if (type === 'quote') d.trackingToken = newToken_();
    row = appendRow_(sheet, type, ref, d);
  } finally {
    lock.releaseLock();
  }

  var sheetLink = ss.getUrl() + '#gid=' + sheet.getSheetId() + '&range=A' + row;
  var ctx = { ref: ref, row: row, sheetLink: sheetLink, submittedAt: d.submittedAt,
              trackUrl: d.trackingToken ? trackUrl_(d.trackingToken) : '' };

  // Emails can fail (quota, bad address) — the row is already saved, so never
  // let that break the submission.
  try { sendCustomerEmail_(type, d, ctx); } catch (err) { console.error('Customer email failed: ' + err); }
  try { sendCompanyEmail_(type, d, ctx);  } catch (err) { console.error('Company email failed: '  + err); }

  return { ref: ref, row: row };
}

/* ------------------------------ one-time setup --------------------------- */

/** Run this once from the editor. Safe to run again. */
function setup() {
  var ss = getSpreadsheet_();
  var quoteSheet = ensureSheet_(ss, 'quote');
  ensureSheet_(ss, 'contact');

  // give every existing quote its private tracking link
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var linked = 0;
  try { linked = backfillTokens_(quoteSheet); } finally { lock.releaseLock(); }

  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(blank);

  var me = Session.getEffectiveUser().getEmail();
  var msg = 'Setup complete. Emails will be sent from: ' + me +
            '\nNext: to use the admin dashboard, run setAdminPassword() (see the comment above that function).' +
            (linked ? '\nCreated tracking links for ' + linked + ' existing request(s).' : '') +
            (trackUrl_('x') ? '' : '\nNOTE: CONFIG.TRACK_URL is empty, so confirmation emails will not include the tracking link yet.');
  if (me && me.toLowerCase() !== CONFIG.SENDER_EMAIL.toLowerCase()) {
    msg += '\nWARNING: you are signed in as ' + me + ' but CONFIG.SENDER_EMAIL is ' + CONFIG.SENDER_EMAIL +
           '. Deploy the web app from ' + CONFIG.SENDER_EMAIL + ' so emails are sent from that address.';
  }
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (ignore) {}
}

/** Sends a sample QUOTE submission end-to-end (row + both emails). */
function testQuoteSubmission() {
  var r = handleSubmission_({
    formType: 'quote',
    submittedAt: new Date().toISOString(),
    name: 'Jane Doe', phone: '(312) 555-0147', email: CONFIG.SENDER_EMAIL,
    bestTime: 'Afternoon', address: '123 Main St', city: 'Deerfield', zip: '60015',
    propertyType: 'Home I live in', finishLevel: 'Premium', timeline: 'Within 1 month',
    insuranceClaim: 'No',
    notes: 'Test submission. Basement is unfinished, ceiling height about 8 ft.',
    itemCount: 4, estimateLow: 28500, estimateHigh: 52000,
    estimateRange: '$28,500 - $52,000',
    selectedItems: 'Basement finishing (800); Basement drywall installation (800); Interior painting (1200)',
    siteVisitItems: 'Basement bathroom; Waterproofing coordination',
    pageUrl: 'https://example.com/pricing.html'
  });
  console.log('Test quote saved as ' + r.ref + ' (row ' + r.row + '). Check the inbox of ' + CONFIG.SENDER_EMAIL + '.');
}

/** Sends a sample CONTACT submission end-to-end (row + both emails). */
function testContactSubmission() {
  var r = handleSubmission_({
    formType: 'contact',
    submittedAt: new Date().toISOString(),
    name: 'John Smith', phone: '(847) 555-0199', email: CONFIG.SENDER_EMAIL,
    subject: 'Restoration',
    message: 'Hi, we had a pipe burst last night and need help with water damage in the kitchen.',
    pageUrl: 'https://example.com/contact.html'
  });
  console.log('Test contact saved as ' + r.ref + ' (row ' + r.row + '). Check the inbox of ' + CONFIG.SENDER_EMAIL + '.');
}

/* ------------------------------ sheet helpers ---------------------------- */

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet found. Create this script from inside the Sheet (Extensions > Apps Script) or set CONFIG.SPREADSHEET_ID.');
  return ss;
}

/** Column number for every header in row 1, e.g. { 'Reference': 1, 'Name': 3, ... } */
function headerMap_(sheet) {
  var map = {};
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return map;
  sheet.getRange(1, 1, 1, lastCol).getValues()[0].forEach(function (h, i) {
    if (h !== '' && h !== null) map[String(h)] = i + 1;
  });
  return map;
}

/**
 * Creates the tab if needed and makes sure every expected column exists.
 * Safe on existing data: missing columns are only ever ADDED at the end,
 * nothing is moved or overwritten. Columns are always found by header name.
 */
function ensureSheet_(ss, type) {
  var name = type === 'contact' ? CONFIG.CONTACT_SHEET : CONFIG.QUOTE_SHEET;
  var cols = type === 'contact' ? CONTACT_COLUMNS : QUOTE_COLUMNS;
  var sheet = ss.getSheetByName(name);
  var created = false;
  if (!sheet) { sheet = ss.insertSheet(name); created = true; }

  var map = headerMap_(sheet);
  var missing = cols.filter(function (c) { return !map[c[0]]; });
  if (!created && missing.length === 0) return sheet;          // already up to date

  var first = sheet.getLastColumn() + 1;
  var needCols = first + missing.length - 1;
  if (sheet.getMaxColumns() < needCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());
  sheet.getRange(1, first, 1, missing.length).setValues([missing.map(function (c) { return c[0]; })]);
  missing.forEach(function (c, i) { map[c[0]] = first + i; });

  var n = sheet.getLastColumn();
  var rows = sheet.getMaxRows();
  var bodyRows = Math.max(rows - 1, 1);

  var headerRange = sheet.getRange(1, 1, 1, n);
  headerRange.setFontWeight('bold').setFontColor('#FFFFFF').setBackground(BRAND.NAVY)
            .setVerticalAlignment('middle').setWrap(true).setNumberFormat('@');
  // The columns the team works in stand out in gold.
  ['Quote Status', 'Actual Price', 'Internal Notes', 'Work Start Date', 'Client Message'].forEach(function (h) {
    if (map[h]) sheet.getRange(1, map[h]).setBackground(BRAND.GOLD).setFontColor(BRAND.NAVY);
  });

  // Number formats by column name (text format also stops phone numbers and
  // ZIPs from being turned into numbers/formulas).
  cols.forEach(function (c) {
    if (map[c[0]]) sheet.getRange(2, map[c[0]], bodyRows, 1).setNumberFormat(c[1]);
  });

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
  sheet.setRowHeight(1, 34);
  if (created) sheet.autoResizeColumns(1, n);
  var widths = { 'Notes': 320, 'Message': 360, 'Selected Items': 320, 'Site-Visit Items': 240, 'Page URL': 220,
                 'Property Address': 220, 'Estimate Range (shown to customer)': 200, 'Internal Notes': 320,
                 'Client Message': 300, 'Tracking Token': 260, 'Work Start Date': 130 };
  cols.forEach(function (c) {
    if (widths[c[0]] && (created || missing.indexOf(c) !== -1)) sheet.setColumnWidth(map[c[0]], widths[c[0]]);
  });
  sheet.getRange(2, 1, bodyRows, n).setVerticalAlignment('top');

  if (created && map['Quote Status']) {
    var statusRange = sheet.getRange(2, map['Quote Status'], bodyRows, 1);
    statusRange.setDataValidation(statusRule_());
    var colours = { 'New': '#FDECC0', 'Contacted': '#DCE8F7', 'Site Visit Scheduled': '#E3DAF5',
                    'Quote Sent': '#D4EEF2', 'Accepted': '#D5EDD9', 'Work in Progress': '#FBE3B8', 'Declined': '#F6D8D6', 'Completed': '#E4E4E4' };
    sheet.setConditionalFormatRules(CONFIG.STATUS_OPTIONS.map(function (s) {
      return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s)
        .setBackground(colours[s] || '#EEEEEE').setRanges([statusRange]).build();
    }));
    sheet.setTabColor(type === 'contact' ? BRAND.NAVY2 : BRAND.GOLD);
  }
  return sheet;
}

function statusRule_() {
  return SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.STATUS_OPTIONS, true).setAllowInvalid(true).build();
}

function nextReference_(type) {
  var props = PropertiesService.getScriptProperties();
  var key = 'seq_' + type;
  var n = Number(props.getProperty(key) || '0') + 1;
  props.setProperty(key, String(n));
  return 'FCV-' + (type === 'contact' ? 'C' : 'Q') + '-' + ('0000' + n).slice(-4);
}

function appendRow_(sheet, type, ref, d) {
  var when = new Date(d.submittedAt);
  if (isNaN(when.getTime())) when = new Date();
  var status = CONFIG.STATUS_OPTIONS[0];
  var rec;
  if (type === 'contact') {
    rec = { 'Reference': ref, 'Submitted At': when, 'Name': d.name, 'Phone': d.phone, 'Email': d.email,
            'Subject': d.subject, 'Message': d.message, 'Page URL': d.pageUrl, 'Quote Status': status };
  } else {
    rec = { 'Reference': ref, 'Submitted At': when, 'Name': d.name, 'Phone': d.phone, 'Email': d.email,
            'Best Time to Reach': d.bestTime, 'Property Address': d.address, 'City': d.city, 'ZIP': d.zip,
            'Property Type': d.propertyType, 'Finish Level': d.finishLevel, 'Start Timeline': d.timeline,
            'Insurance Claim': d.insuranceClaim, 'Notes': d.notes, 'Selected Items': d.selectedItems,
            'Site-Visit Items': d.siteVisitItems, 'Item Count': d.itemCount,
            'Estimate Low': d.estimateLow, 'Estimate High': d.estimateHigh,
            'Estimate Range (shown to customer)': d.estimateRange, 'Page URL': d.pageUrl, 'Quote Status': status,
            'Tracking Token': d.trackingToken || '' };
  }
  var map = headerMap_(sheet);
  var n = sheet.getLastColumn();
  var values = [];
  for (var i = 0; i < n; i++) values.push('');
  Object.keys(rec).forEach(function (h) { if (map[h]) values[map[h] - 1] = rec[h]; });
  sheet.appendRow(values);
  var row = sheet.getLastRow();
  if (map['Quote Status']) sheet.getRange(row, map['Quote Status']).setDataValidation(statusRule_());
  sheet.getRange(row, 1, 1, n).setVerticalAlignment('top');
  return row;
}

/* ------------------------------ input cleaning --------------------------- */

function str_(v, max, multiline) {
  var s = (v === null || v === undefined) ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (!multiline) s = s.replace(/\s+/g, ' ');           // single-line fields: no line breaks
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}
function num_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isFinite(n) ? n : '';
}
function requireEmail_(email) {
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(email)) throw new Error('Invalid email address');
}

function cleanQuote_(x) {
  var d = {
    submittedAt:    str_(x.submittedAt, 40),
    name:           str_(x.name, 120),
    phone:          str_(x.phone, 40),
    email:          str_(x.email, 160),
    bestTime:       str_(x.bestTime, 40),
    address:        str_(x.address, 200),
    city:           str_(x.city, 80),
    zip:            str_(x.zip, 12),
    propertyType:   str_(x.propertyType, 80),
    finishLevel:    str_(x.finishLevel, 80),
    timeline:       str_(x.timeline, 80),
    insuranceClaim: str_(x.insuranceClaim, 80),
    notes:          str_(x.notes, 5000, true),
    itemCount:      num_(x.itemCount) === '' ? 0 : num_(x.itemCount),
    estimateLow:    num_(x.estimateLow),
    estimateHigh:   num_(x.estimateHigh),
    estimateRange:  str_(x.estimateRange, 80),
    selectedItems:  str_(x.selectedItems, 4000),
    siteVisitItems: str_(x.siteVisitItems, 2000),
    pageUrl:        str_(x.pageUrl, 300)
  };
  if (!d.name || !d.phone) throw new Error('Name and phone are required');
  requireEmail_(d.email);
  return d;
}

function cleanContact_(x) {
  var d = {
    submittedAt: str_(x.submittedAt, 40),
    name:        str_(x.name, 120),
    phone:       str_(x.phone, 40),
    email:       str_(x.email, 160),
    subject:     str_(x.subject, 120) || 'General enquiry',
    message:     str_(x.message, 5000, true),
    pageUrl:     str_(x.pageUrl, 300)
  };
  if (!d.name || !d.phone) throw new Error('Name and phone are required');
  requireEmail_(d.email);
  return d;
}

/* --------------------------------- emails -------------------------------- */

function sendCustomerEmail_(type, d, ctx) {
  var first = firstName_(d.name);
  var subject, html, text;
  if (type === 'contact') {
    subject = 'We got your message, ' + first + ' (' + ctx.ref + ')';
    html = customerContactHtml_(d, ctx, first);
    text = customerContactText_(d, ctx, first);
  } else {
    subject = 'We\u2019ve received your quote request, ' + first + ' (' + ctx.ref + ')';
    html = customerQuoteHtml_(d, ctx, first);
    text = customerQuoteText_(d, ctx, first);
  }
  MailApp.sendEmail({
    to: d.email,
    subject: subject,
    body: text,
    htmlBody: html,
    name: CONFIG.SENDER_NAME,
    replyTo: CONFIG.CUSTOMER_REPLY_TO,
    inlineImages: { fcvlogo: logoBlob_() }
  });
}

function sendCompanyEmail_(type, d, ctx) {
  var subject, html, text;
  if (type === 'contact') {
    subject = 'New contact message: ' + d.subject + ' \u00B7 ' + d.name + ' (' + ctx.ref + ')';
    html = companyContactHtml_(d, ctx);
    text = companyContactText_(d, ctx);
  } else {
    var est = d.estimateRange || 'Site visit needed';
    subject = 'New quote request: ' + d.name + ' \u00B7 ' + est + ' (' + ctx.ref + ')';
    html = companyQuoteHtml_(d, ctx);
    text = companyQuoteText_(d, ctx);
  }
  MailApp.sendEmail({
    to: CONFIG.COMPANY_RECIPIENTS.join(','),
    subject: subject,
    body: text,
    htmlBody: html,
    name: CONFIG.SENDER_NAME + ' (website)',
    replyTo: d.email,                                   // hitting Reply writes to the customer
    inlineImages: { fcvlogo: logoBlob_() }
  });
}

function logoBlob_() {
  return Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'fcv-logo.png');
}

/* -------- shared email building blocks (table layout, inline CSS) -------- */

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function nl2br_(s) { return esc_(s).replace(/\r?\n/g, '<br>'); }
function firstName_(name) { return (String(name).trim().split(/\s+/)[0]) || 'there'; }
function list_(s) { return String(s || '').split(/\s*;\s*/).filter(function (x) { return x; }); }
function fmtDate_(iso) {
  var dt = new Date(iso); if (isNaN(dt.getTime())) dt = new Date();
  return Utilities.formatDate(dt, CONFIG.TIMEZONE, 'EEE, MMM d, yyyy \u00B7 h:mm a z');
}
var FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
var SERIF = "Georgia,'Times New Roman',serif";

function shell_(inner, preheader, bodyBg) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">' +
    '<title>' + esc_(CONFIG.COMPANY_NAME) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + bodyBg + ';-webkit-text-size-adjust:100%;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">' +
    esc_(preheader) + '&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + bodyBg + '"><tr>' +
    '<td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" ' +
    'style="width:100%;max-width:620px;background:#FFFFFF;border-radius:4px;overflow:hidden;">' +
    inner +
    '</table></td></tr></table></body></html>';
}

function button_(href, label, solid) {
  var bg = solid ? BRAND.GOLD : '#FFFFFF', fg = BRAND.NAVY, border = solid ? BRAND.GOLD : BRAND.NAVY;
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 8px 8px 0;"><tr>' +
    '<td bgcolor="' + bg + '" style="border:2px solid ' + border + ';border-radius:2px;">' +
    '<a href="' + esc_(href) + '" style="display:inline-block;padding:12px 22px;font-family:' + FONT +
    ';font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:' + fg +
    ';text-decoration:none;">' + esc_(label) + '</a></td></tr></table>';
}

function kv_(label, valueHtml) {
  if (valueHtml === '' || valueHtml === null || valueHtml === undefined) return '';
  return '<tr><td valign="top" style="padding:10px 16px 10px 0;width:36%;font-family:' + FONT +
    ';font-size:12px;letter-spacing:1px;text-transform:uppercase;color:' + BRAND.MUTED +
    ';border-bottom:1px solid ' + BRAND.LINE + ';">' + esc_(label) + '</td>' +
    '<td valign="top" style="padding:10px 0;font-family:' + FONT + ';font-size:15px;line-height:1.5;color:' + BRAND.INK +
    ';border-bottom:1px solid ' + BRAND.LINE + ';">' + valueHtml + '</td></tr>';
}

function bullets_(items, color) {
  return items.map(function (it) {
    return '<tr><td valign="top" width="18" style="padding:5px 0;font-family:' + FONT + ';color:' + (color || BRAND.GOLD) +
      ';font-size:16px;line-height:1.4;">&#9632;</td><td style="padding:5px 0;font-family:' + FONT +
      ';font-size:15px;line-height:1.5;color:' + BRAND.INK + ';">' + esc_(it) + '</td></tr>';
  }).join('');
}

function sectionTitle_(text) {
  return '<div style="font-family:' + FONT + ';font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;' +
    'color:' + BRAND.NAVY + ';padding:0 0 10px 0;border-bottom:2px solid ' + BRAND.GOLD + ';margin:0 0 6px 0;">' + esc_(text) + '</div>';
}

function steps_(arr) {
  return arr.map(function (s, i) {
    return '<tr><td valign="top" width="44" style="padding:10px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td width="32" height="32" align="center" bgcolor="' + BRAND.NAVY + '" style="border-radius:16px;font-family:' + FONT +
      ';font-size:14px;font-weight:700;color:' + BRAND.GOLD + ';">' + (i + 1) + '</td></tr></table></td>' +
      '<td valign="top" style="padding:10px 0;font-family:' + FONT + ';font-size:15px;line-height:1.5;color:' + BRAND.INK + ';">' +
      '<strong style="color:' + BRAND.NAVY + ';">' + esc_(s[0]) + '</strong><br><span style="color:' + BRAND.MUTED + ';">' + esc_(s[1]) + '</span></td></tr>';
  }).join('');
}

/* ---- CUSTOMER emails: warm, reassuring, navy + gold on sandstone ---- */

function customerHeader_() {
  return '<tr><td align="center" bgcolor="' + BRAND.NAVY + '" style="padding:30px 20px 24px 20px;">' +
    '<img src="cid:fcvlogo" width="170" alt="' + esc_(CONFIG.COMPANY_NAME) + '" style="display:block;border:0;outline:none;width:170px;height:auto;">' +
    '</td></tr><tr><td height="5" bgcolor="' + BRAND.GOLD + '" style="font-size:0;line-height:0;">&nbsp;</td></tr>';
}

function customerFooter_(refLine) {
  var web = CONFIG.WEBSITE_URL
    ? '<br><a href="' + esc_(CONFIG.WEBSITE_URL) + '" style="color:' + BRAND.GOLD + ';text-decoration:none;">' + esc_(CONFIG.WEBSITE_URL.replace(/^https?:\/\//, '')) + '</a>' : '';
  return '<tr><td bgcolor="' + BRAND.NAVY + '" align="center" style="padding:28px 30px;font-family:' + FONT + ';font-size:13px;line-height:1.7;color:#B8C2CE;">' +
    '<strong style="color:#FFFFFF;letter-spacing:1px;">' + esc_(CONFIG.COMPANY_NAME.toUpperCase()) + '</strong><br>' +
    esc_(CONFIG.ADDRESS) + '<br>' +
    '<a href="tel:' + CONFIG.PHONE_TEL + '" style="color:' + BRAND.GOLD + ';text-decoration:none;">' + esc_(CONFIG.PHONE_DISPLAY) + '</a>' +
    ' &nbsp;|&nbsp; <a href="mailto:' + CONFIG.PUBLIC_EMAIL + '" style="color:' + BRAND.GOLD + ';text-decoration:none;">' + esc_(CONFIG.PUBLIC_EMAIL) + '</a>' + web +
    '<br><span style="font-size:11px;color:#8695A6;">' + esc_(refLine) + '</span></td></tr>';
}

function priceNotice_(intro) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px 0;"><tr>' +
    '<td width="5" bgcolor="' + BRAND.GOLD + '" style="font-size:0;">&nbsp;</td>' +
    '<td bgcolor="#FFF8E6" style="padding:16px 18px;font-family:' + FONT + ';font-size:14px;line-height:1.6;color:' + BRAND.INK + ';">' +
    '<strong style="color:' + BRAND.NAVY + ';font-size:15px;">Please keep in mind: pricing can change.</strong><br>' + intro +
    '</td></tr></table>';
}

function trackCard_(url) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + BRAND.NAVY + '" style="margin:26px 0 0 0;border-radius:3px;"><tr><td style="padding:24px 26px 18px 26px;">' +
    '<div style="font-family:' + FONT + ';font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' + BRAND.GOLD + ';">Follow your request</div>' +
    '<div style="font-family:' + SERIF + ';font-size:23px;line-height:1.3;color:#FFFFFF;padding:6px 0 8px 0;">Track it online, any time</div>' +
    '<div style="font-family:' + FONT + ';font-size:14px;line-height:1.65;color:#C9D2DC;padding-bottom:18px;">See what you selected, where your request stands, when work can start, and your actual quote once we\u2019ve visited. This link is private to you, so please don\u2019t share it.</div>' +
    button_(url, 'View my request', true) + '</td></tr></table>';
}

function customerQuoteHtml_(d, ctx, first) {
  var range = d.estimateRange && d.estimateRange !== 'Site visit needed' ? d.estimateRange : '';
  var items = list_(d.selectedItems), visit = list_(d.siteVisitItems);

  var estimate = range
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + BRAND.SAND + '" style="margin:26px 0 18px 0;border-radius:3px;"><tr><td align="center" style="padding:24px 18px;">' +
      '<div style="font-family:' + FONT + ';font-size:12px;letter-spacing:2px;text-transform:uppercase;color:' + BRAND.MUTED + ';">Your rough estimate</div>' +
      '<div style="font-family:' + SERIF + ';font-size:34px;line-height:1.2;color:' + BRAND.NAVY + ';padding:8px 0 4px 0;">' + esc_(range) + '</div>' +
      '<div style="font-family:' + FONT + ';font-size:13px;color:' + BRAND.MUTED + ';">Labour and standard materials, before permits and tax</div></td></tr></table>'
    : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + BRAND.SAND + '" style="margin:26px 0 18px 0;border-radius:3px;"><tr><td align="center" style="padding:22px 18px;font-family:' + FONT + ';font-size:15px;line-height:1.6;color:' + BRAND.NAVY + ';">' +
      '<strong>Your project needs a site visit to be priced.</strong><br><span style="color:' + BRAND.MUTED + ';">We\u2019ll give you a firm number after we\u2019ve seen the work in person.</span></td></tr></table>';

  var notice = priceNotice_(
    (range ? 'The range above is only a <strong>rough estimate</strong> from the calculator on our website, built from our published rates. ' : 'Any price you saw on our website is only a <strong>rough estimate</strong>. ') +
    'It is not a final quote. Your price can change once our team visits your property and sees the work first-hand &mdash; ' +
    'hidden conditions, materials, access and permits all affect the final number. We\u2019ll confirm your actual price with you after the visit.');

  var scope = items.length
    ? sectionTitle_('The work you selected') + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + bullets_(items) + '</table>' : '';
  var visitBlock = visit.length
    ? '<div style="height:14px;"></div>' + sectionTitle_('Priced at the site visit') + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + bullets_(visit, BRAND.NAVY) + '</table>' : '';

  var details = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    kv_('Name', esc_(d.name)) + kv_('Phone', esc_(d.phone)) + kv_('Email', esc_(d.email)) +
    kv_('Best time to reach you', esc_(d.bestTime)) +
    kv_('Property', esc_([d.address, d.city, d.zip].filter(Boolean).join(', '))) +
    kv_('Property type', esc_(d.propertyType)) + kv_('Finish level', esc_(d.finishLevel)) +
    kv_('Hoping to start', esc_(d.timeline)) + kv_('Insurance claim', esc_(d.insuranceClaim)) +
    (d.notes ? kv_('Your notes', nl2br_(d.notes)) : '') + '</table>';

  var next = steps_([
    ['We review your request', 'Our team looks over the work you selected and your property details.'],
    ['We call to arrange a site visit', 'Usually within two business days' + (d.bestTime && d.bestTime !== 'Any time' ? ' \u2014 and we\u2019ll try for the ' + d.bestTime.toLowerCase() + ' you asked for.' : '.')],
    ['You get your actual price', 'After we\u2019ve seen the work, we confirm your final quote.']
  ]);

  var inner =
    customerHeader_() +
    '<tr><td style="padding:38px 40px 8px 40px;">' +
      '<div style="font-family:' + FONT + ';font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#B7860B;">Quote request received</div>' +
      '<h1 style="margin:10px 0 12px 0;font-family:' + SERIF + ';font-size:30px;line-height:1.25;font-weight:normal;color:' + BRAND.NAVY + ';">Thank you, ' + esc_(first) + '. Your request is in.</h1>' +
      '<p style="margin:0;font-family:' + FONT + ';font-size:16px;line-height:1.65;color:' + BRAND.INK + ';">We\u2019ve got your details and the work you\u2019d like priced. Here\u2019s a copy of what you sent us, and what happens next.</p>' +
      '<p style="margin:16px 0 0 0;font-family:' + FONT + ';font-size:13px;color:' + BRAND.MUTED + ';">Reference: <strong style="color:' + BRAND.NAVY + ';">' + esc_(ctx.ref) + '</strong> &nbsp;&middot;&nbsp; ' + esc_(fmtDate_(ctx.submittedAt)) + '</p>' +
      (ctx.trackUrl ? trackCard_(ctx.trackUrl) : '') + estimate + notice +
    '</td></tr>' +
    '<tr><td style="padding:22px 40px 6px 40px;">' + scope + visitBlock + '</td></tr>' +
    '<tr><td style="padding:22px 40px 6px 40px;">' + sectionTitle_('What happens next') + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + next + '</table></td></tr>' +
    '<tr><td style="padding:22px 40px 6px 40px;">' + sectionTitle_('Your details') + details + '</td></tr>' +
    '<tr><td style="padding:26px 40px 36px 40px;">' +
      '<p style="margin:0 0 14px 0;font-family:' + FONT + ';font-size:15px;line-height:1.6;color:' + BRAND.INK + ';">Need us sooner, or want to add something? Just reply to this email or give us a call.</p>' +
      button_('tel:' + CONFIG.PHONE_TEL, 'Call ' + CONFIG.PHONE_DISPLAY, true) +
      button_('mailto:' + CONFIG.PUBLIC_EMAIL + '?subject=' + encodeURIComponent('Re: my quote request ' + ctx.ref), 'Email us', false) +
    '</td></tr>' +
    customerFooter_('Reference ' + ctx.ref + ' \u00B7 You\u2019re receiving this because you requested a quote on our website.');

  return shell_(inner, 'We\u2019ve received your request. Your online price is a rough estimate and may change after a site visit.', BRAND.PAPER);
}

function customerQuoteText_(d, ctx, first) {
  var range = d.estimateRange && d.estimateRange !== 'Site visit needed' ? d.estimateRange : '';
  var out = [];
  out.push('Thank you, ' + first + '. Your quote request is in.');
  out.push('Reference: ' + ctx.ref);
  if (ctx.trackUrl) out.push('Track your request online (private link, please don\u2019t share it): ' + ctx.trackUrl);
  out.push('');
  if (range) out.push('Your rough estimate: ' + range + ' (labour and standard materials, before permits and tax)');
  out.push('PLEASE KEEP IN MIND: PRICING CAN CHANGE. The price shown on our website is only a rough estimate, not a final quote. ' +
           'Your price can change once our team visits your property and sees the work in person. We will confirm your actual price after the visit.');
  out.push('');
  var items = list_(d.selectedItems), visit = list_(d.siteVisitItems);
  if (items.length) { out.push('The work you selected:'); items.forEach(function (i) { out.push(' - ' + i); }); out.push(''); }
  if (visit.length) { out.push('Priced at the site visit:'); visit.forEach(function (i) { out.push(' - ' + i); }); out.push(''); }
  out.push('What happens next:');
  out.push(' 1. We review your request.');
  out.push(' 2. We call to arrange a site visit (usually within two business days).');
  out.push(' 3. After the visit, we confirm your actual price.');
  out.push('');
  out.push('Your details: ' + d.name + ' | ' + d.phone + ' | ' + d.email);
  out.push('Property: ' + [d.address, d.city, d.zip].filter(Boolean).join(', '));
  if (d.notes) out.push('Your notes: ' + d.notes);
  out.push('');
  out.push('Questions? Reply to this email or call ' + CONFIG.PHONE_DISPLAY + '.');
  out.push(CONFIG.COMPANY_NAME + ' | ' + CONFIG.ADDRESS);
  return out.join('\n');
}

function customerContactHtml_(d, ctx, first) {
  var notice = priceNotice_('If you\u2019ve seen prices on our website, they are only <strong>rough estimates</strong>. Your final price can change once our team visits your property and sees the work in person; we\u2019ll confirm your actual price with you after the visit.');
  var next = steps_([
    ['We read your message', 'Someone on our team will go through the details you sent.'],
    ['We get back to you', 'We\u2019ll reach out by phone or email as soon as we can.'],
    ['We plan the next step', 'If it makes sense, we\u2019ll arrange a free site visit.']
  ]);
  var inner =
    customerHeader_() +
    '<tr><td style="padding:38px 40px 8px 40px;">' +
      '<div style="font-family:' + FONT + ';font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#B7860B;">Message received</div>' +
      '<h1 style="margin:10px 0 12px 0;font-family:' + SERIF + ';font-size:30px;line-height:1.25;font-weight:normal;color:' + BRAND.NAVY + ';">Thanks for reaching out, ' + esc_(first) + '.</h1>' +
      '<p style="margin:0;font-family:' + FONT + ';font-size:16px;line-height:1.65;color:' + BRAND.INK + ';">We\u2019ve received your message and a member of our team will be in touch shortly.</p>' +
      '<p style="margin:16px 0 18px 0;font-family:' + FONT + ';font-size:13px;color:' + BRAND.MUTED + ';">Reference: <strong style="color:' + BRAND.NAVY + ';">' + esc_(ctx.ref) + '</strong> &nbsp;&middot;&nbsp; ' + esc_(fmtDate_(ctx.submittedAt)) + '</p>' +
      notice +
    '</td></tr>' +
    '<tr><td style="padding:22px 40px 6px 40px;">' + sectionTitle_('Your message') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + kv_('Subject', esc_(d.subject)) + kv_('Phone', esc_(d.phone)) + kv_('Email', esc_(d.email)) + (d.message ? kv_('Message', nl2br_(d.message)) : '') + '</table></td></tr>' +
    '<tr><td style="padding:22px 40px 6px 40px;">' + sectionTitle_('What happens next') + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + next + '</table></td></tr>' +
    '<tr><td style="padding:26px 40px 36px 40px;">' +
      '<p style="margin:0 0 14px 0;font-family:' + FONT + ';font-size:15px;line-height:1.6;color:' + BRAND.INK + ';">Want a faster answer? Call us or reply to this email.</p>' +
      button_('tel:' + CONFIG.PHONE_TEL, 'Call ' + CONFIG.PHONE_DISPLAY, true) +
      button_('mailto:' + CONFIG.PUBLIC_EMAIL + '?subject=' + encodeURIComponent('Re: ' + ctx.ref), 'Email us', false) +
    '</td></tr>' +
    customerFooter_('Reference ' + ctx.ref + ' \u00B7 You\u2019re receiving this because you contacted us through our website.');
  return shell_(inner, 'We\u2019ve received your message and will be in touch shortly.', BRAND.PAPER);
}

function customerContactText_(d, ctx, first) {
  return ['Thanks for reaching out, ' + first + '.',
    'We\u2019ve received your message and a member of our team will be in touch shortly.',
    'Reference: ' + ctx.ref, '',
    'PLEASE KEEP IN MIND: PRICING CAN CHANGE. Any price shown on our website is only a rough estimate. Your final price can change once our team visits your property and sees the work in person; we will confirm your actual price after the visit.', '',
    'Subject: ' + d.subject, 'Phone: ' + d.phone, 'Email: ' + d.email, 'Message: ' + d.message, '',
    'Want a faster answer? Call ' + CONFIG.PHONE_DISPLAY + ' or reply to this email.',
    CONFIG.COMPANY_NAME + ' | ' + CONFIG.ADDRESS].join('\n');
}

/* ---- COMPANY emails: internal alert, scannable, action buttons ---- */

function companyShell_(label, ref, titleHtml, subHtml, body, footerNote) {
  var inner =
    '<tr><td bgcolor="' + BRAND.GOLD + '" style="padding:14px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td style="font-family:' + FONT + ';font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:' + BRAND.NAVY + ';">' + esc_(label) + '</td>' +
      '<td align="right" style="font-family:' + FONT + ';font-size:13px;font-weight:700;color:' + BRAND.NAVY + ';">' + esc_(ref) + '</td></tr></table></td></tr>' +
    '<tr><td bgcolor="' + BRAND.NAVY + '" style="padding:26px 28px 24px 28px;">' +
      '<div style="font-family:' + FONT + ';font-size:26px;line-height:1.25;font-weight:700;color:#FFFFFF;">' + titleHtml + '</div>' +
      '<div style="font-family:' + FONT + ';font-size:14px;line-height:1.6;color:#B8C2CE;padding-top:6px;">' + subHtml + '</div></td></tr>' +
    body +
    '<tr><td bgcolor="#F3F4F6" style="padding:16px 28px;font-family:' + FONT + ';font-size:12px;line-height:1.6;color:' + BRAND.MUTED + ';">' + footerNote + '</td></tr>';
  return shell_(inner, label + ' \u2014 ' + ref, '#E5E7EB');
}

function mapLink_(d) {
  var q = [d.address, d.city, d.zip].filter(Boolean).join(', ');
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
}

function companyQuoteHtml_(d, ctx) {
  var range = d.estimateRange || 'Site visit needed';
  var items = list_(d.selectedItems), visit = list_(d.siteVisitItems);
  var fullAddr = [d.address, d.city, d.zip].filter(Boolean).join(', ');
  var map = mapLink_(d);

  var summary = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="50%" valign="top" style="padding:0 8px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF8E6" style="border:1px solid #F3D88A;border-radius:3px;"><tr><td style="padding:14px 16px;">' +
      '<div style="font-family:' + FONT + ';font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:' + BRAND.MUTED + ';">Rough estimate shown to customer</div>' +
      '<div style="font-family:' + FONT + ';font-size:20px;font-weight:700;color:' + BRAND.NAVY + ';padding-top:4px;">' + esc_(range) + '</div></td></tr></table></td>' +
    '<td width="50%" valign="top" style="padding:0 0 0 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F6" style="border-radius:3px;"><tr><td style="padding:14px 16px;">' +
      '<div style="font-family:' + FONT + ';font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:' + BRAND.MUTED + ';">Items selected</div>' +
      '<div style="font-family:' + FONT + ';font-size:20px;font-weight:700;color:' + BRAND.NAVY + ';padding-top:4px;">' + esc_(d.itemCount || items.length) + (visit.length ? ' <span style="font-size:13px;font-weight:400;color:' + BRAND.MUTED + ';">(' + visit.length + ' need site visit)</span>' : '') + '</div></td></tr></table></td></tr></table>';

  var actions =
    button_('tel:' + d.phone.replace(/[^\d+]/g, ''), 'Call ' + firstName_(d.name), true) +
    button_('mailto:' + d.email + '?subject=' + encodeURIComponent('Your quote request ' + ctx.ref + ' \u2014 ' + CONFIG.COMPANY_NAME), 'Email customer', false) +
    button_(ctx.sheetLink, 'Open in sheet', false) +
    (CONFIG.ADMIN_URL ? button_(CONFIG.ADMIN_URL.replace(/#.*$/, '') + '#' + ctx.ref, 'Open in dashboard', false) : '');

  var facts = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    kv_('Phone', '<a href="tel:' + esc_(d.phone.replace(/[^\d+]/g, '')) + '" style="color:' + BRAND.NAVY + ';">' + esc_(d.phone) + '</a>') +
    kv_('Email', '<a href="mailto:' + esc_(d.email) + '" style="color:' + BRAND.NAVY + ';">' + esc_(d.email) + '</a>') +
    kv_('Best time to reach', esc_(d.bestTime)) +
    kv_('Property address', esc_(fullAddr) + (map ? ' &nbsp;<a href="' + esc_(map) + '" style="color:#B7860B;font-size:13px;">Map</a>' : '')) +
    kv_('Property type', esc_(d.propertyType)) + kv_('Finish level', esc_(d.finishLevel)) +
    kv_('Wants to start', esc_(d.timeline)) + kv_('Insurance claim', esc_(d.insuranceClaim)) +
    kv_('Submitted', esc_(fmtDate_(ctx.submittedAt))) + '</table>';

  var scope = '';
  if (items.length) scope += sectionTitle_('Priced work (' + items.length + ')') + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + bullets_(items) + '</table>';
  if (visit.length) scope += '<div style="height:14px;"></div>' + sectionTitle_('Needs a site visit (' + visit.length + ')') + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + bullets_(visit, '#C2410C') + '</table>';

  var notes = d.notes
    ? sectionTitle_('Customer notes') + '<div style="font-family:' + FONT + ';font-size:15px;line-height:1.65;color:' + BRAND.INK + ';background:#F9FAFB;border-left:4px solid ' + BRAND.NAVY + ';padding:14px 16px;">' + nl2br_(d.notes) + '</div>' : '';

  var body =
    '<tr><td style="padding:24px 28px 4px 28px;">' + summary + '</td></tr>' +
    '<tr><td style="padding:18px 28px 0 28px;">' + actions + '</td></tr>' +
    '<tr><td style="padding:14px 28px 4px 28px;">' + sectionTitle_('Customer & property') + facts + '</td></tr>' +
    (scope ? '<tr><td style="padding:20px 28px 4px 28px;">' + scope + '</td></tr>' : '') +
    (notes ? '<tr><td style="padding:20px 28px 4px 28px;">' + notes + '</td></tr>' : '') +
    '<tr><td style="padding:22px 28px 26px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F6" style="border-radius:3px;"><tr><td style="padding:14px 16px;font-family:' + FONT + ';font-size:13px;line-height:1.6;color:' + BRAND.INK + ';">' +
      '<strong>To do:</strong> update <em>Quote Status</em> and enter the <em>Actual Price</em> in the sheet once the site visit is done. The customer was told the online range is only a rough estimate and may change after the visit.</td></tr></table></td></tr>';

  return companyShell_('New quote request', ctx.ref, esc_(d.name),
    esc_(range) + ' &nbsp;&middot;&nbsp; ' + esc_([d.city, d.zip].filter(Boolean).join(' ')), body,
    'Sent automatically by the website quote form. Replying to this email replies to the customer (' + esc_(d.email) + ').');
}

function companyQuoteText_(d, ctx) {
  var out = ['NEW QUOTE REQUEST ' + ctx.ref, '', d.name + ' | ' + d.phone + ' | ' + d.email,
    'Estimate shown: ' + (d.estimateRange || 'Site visit needed'),
    'Address: ' + [d.address, d.city, d.zip].filter(Boolean).join(', '),
    'Best time: ' + d.bestTime, 'Property: ' + d.propertyType + ' | Finish: ' + d.finishLevel,
    'Start: ' + d.timeline + ' | Insurance claim: ' + d.insuranceClaim, ''];
  var items = list_(d.selectedItems), visit = list_(d.siteVisitItems);
  if (items.length) { out.push('Priced work:'); items.forEach(function (i) { out.push(' - ' + i); }); }
  if (visit.length) { out.push('Needs site visit:'); visit.forEach(function (i) { out.push(' - ' + i); }); }
  if (d.notes) { out.push(''); out.push('Notes: ' + d.notes); }
  out.push(''); out.push('Sheet: ' + ctx.sheetLink);
  return out.join('\n');
}

function companyContactHtml_(d, ctx) {
  var actions =
    button_('tel:' + d.phone.replace(/[^\d+]/g, ''), 'Call ' + firstName_(d.name), true) +
    button_('mailto:' + d.email + '?subject=' + encodeURIComponent('Re: your message to ' + CONFIG.COMPANY_NAME + ' (' + ctx.ref + ')'), 'Reply by email', false) +
    button_(ctx.sheetLink, 'Open in sheet', false) +
    (CONFIG.ADMIN_URL ? button_(CONFIG.ADMIN_URL.replace(/#.*$/, '') + '#' + ctx.ref, 'Open in dashboard', false) : '');
  var body =
    '<tr><td style="padding:22px 28px 0 28px;">' + actions + '</td></tr>' +
    '<tr><td style="padding:14px 28px 4px 28px;">' + sectionTitle_('Contact details') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      kv_('Subject', '<strong>' + esc_(d.subject) + '</strong>') +
      kv_('Phone', '<a href="tel:' + esc_(d.phone.replace(/[^\d+]/g, '')) + '" style="color:' + BRAND.NAVY + ';">' + esc_(d.phone) + '</a>') +
      kv_('Email', '<a href="mailto:' + esc_(d.email) + '" style="color:' + BRAND.NAVY + ';">' + esc_(d.email) + '</a>') +
      kv_('Submitted', esc_(fmtDate_(ctx.submittedAt))) + '</table></td></tr>' +
    '<tr><td style="padding:20px 28px 26px 28px;">' + sectionTitle_('Message') +
      '<div style="font-family:' + FONT + ';font-size:15px;line-height:1.65;color:' + BRAND.INK + ';background:#F9FAFB;border-left:4px solid ' + BRAND.NAVY + ';padding:14px 16px;">' +
      (d.message ? nl2br_(d.message) : '<em style="color:' + BRAND.MUTED + ';">(no message entered)</em>') + '</div></td></tr>';
  return companyShell_('New contact message', ctx.ref, esc_(d.name), esc_(d.subject), body,
    'Sent automatically by the website contact form. Replying to this email replies to the customer (' + esc_(d.email) + ').');
}

function companyContactText_(d, ctx) {
  return ['NEW CONTACT MESSAGE ' + ctx.ref, '', d.name + ' | ' + d.phone + ' | ' + d.email,
    'Subject: ' + d.subject, '', d.message || '(no message)', '', 'Sheet: ' + ctx.sheetLink].join('\n');
}

/* ============================================================================
 *  ADMIN DASHBOARD API  (used by admin.html)
 * ============================================================================
 *  The password is checked HERE, on Google's server — never in the web page.
 *  Nothing is returned without a valid sign-in, so the page itself holds no data.
 *
 *  HOW TO SET (OR CHANGE) THE PASSWORD
 *    1. Replace the text between the quotes in setAdminPassword() below with
 *       your new password (at least 10 characters).
 *    2. Choose setAdminPassword in the function dropdown and click Run.
 *    3. Put the placeholder text back so the password isn't left in the code.
 *  Only a salted hash is stored. Changing the password signs everyone out.
 * ========================================================================== */

function setAdminPassword() {
  var NEW_PASSWORD = 'CHANGE-THIS-TO-YOUR-PASSWORD';
  storeAdminPassword_(NEW_PASSWORD);
}

function storeAdminPassword_(pw) {
  pw = String(pw || '');
  if (pw === 'CHANGE-THIS-TO-YOUR-PASSWORD' || pw.length < 10) {
    throw new Error('Replace CHANGE-THIS-TO-YOUR-PASSWORD with a password of at least 10 characters, then run again.');
  }
  var salt = Utilities.getUuid();
  var secret = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({ ADMIN_SALT: salt, ADMIN_HASH: sha256_(salt + pw), ADMIN_SECRET: secret });
  CacheService.getScriptCache().removeAll(['adm_fails', 'adm_locked']);
  console.log('Admin password saved. Anyone signed in before has been signed out.');
}

var EDITABLE_FIELDS = {
  quote:   ['Name', 'Phone', 'Email', 'Best Time to Reach', 'Property Address', 'City', 'ZIP', 'Property Type',
            'Finish Level', 'Start Timeline', 'Insurance Claim', 'Notes', 'Quote Status', 'Actual Price', 'Internal Notes',
            'Work Start Date', 'Client Message'],
  contact: ['Name', 'Phone', 'Email', 'Subject', 'Quote Status', 'Actual Price', 'Internal Notes']
};
var FIELD_MAX = { 'Name': 120, 'Phone': 40, 'Email': 160, 'Best Time to Reach': 40, 'Property Address': 200, 'City': 80,
                  'ZIP': 12, 'Property Type': 80, 'Finish Level': 80, 'Start Timeline': 80, 'Insurance Claim': 80,
                  'Notes': 5000, 'Subject': 120, 'Internal Notes': 5000, 'Client Message': 1000 };

function handleAdmin_(data) {
  try {
    switch (data.action) {
      case 'track':  return trackLookup_(data.token);               // public: customer tracking page
      case 'login':  return adminLogin_(data.password);
      case 'list':   requireAdmin_(data.token); return adminList_();
      case 'update': requireAdmin_(data.token); return adminUpdate_(data);
      // Server-to-server calls from the FCV Client & Lender Portal (Netlify). Guarded by a secret service key.
      case 'svc_list':   requireService_(data.serviceKey); return adminList_();
      case 'svc_update': requireService_(data.serviceKey); return adminUpdate_(data);
      default:       throw err_('unknown', 'Unknown action');
    }
  } catch (e) {
    if (!e.code) console.error('admin action failed: ' + (e && e.stack ? e.stack : e));
    return { ok: false, error: String(e && e.message ? e.message : e), code: e.code || 'error' };
  }
}

function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join(''); }
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hmac_(msg, key) { return hex_(Utilities.computeHmacSha256Signature(msg, key)); }
function safeEq_(a, b) {                                         // constant-time compare
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function adminLogin_(password) {
  var cache = CacheService.getScriptCache();
  var p = PropertiesService.getScriptProperties().getProperties();
  if (!p.ADMIN_HASH) throw err_('not_set', 'The admin password has not been set yet. In Apps Script, run setAdminPassword().');
  if (cache.get('adm_locked')) throw err_('locked', 'Too many wrong attempts. Please wait ' + CONFIG.ADMIN_LOCK_MINUTES + ' minutes and try again.');

  if (!safeEq_(sha256_(p.ADMIN_SALT + String(password || '')), p.ADMIN_HASH)) {
    var fails = Number(cache.get('adm_fails') || 0) + 1;
    if (fails >= CONFIG.ADMIN_MAX_FAILS) {
      cache.put('adm_locked', '1', CONFIG.ADMIN_LOCK_MINUTES * 60);
      cache.remove('adm_fails');
    } else {
      cache.put('adm_fails', String(fails), CONFIG.ADMIN_LOCK_MINUTES * 60);
    }
    Utilities.sleep(900);                                          // slows down guessing
    throw err_('bad_password', 'Incorrect password.');
  }
  cache.remove('adm_fails');
  var exp = Date.now() + CONFIG.ADMIN_SESSION_HOURS * 3600 * 1000;
  return { ok: true, token: exp + '.' + hmac_(String(exp), p.ADMIN_SECRET), expiresAt: exp };
}

/** Run this ONCE in the Apps Script editor after pasting a long random key below. Put the same key in Netlify as FCV_SHEET_SERVICE_KEY. */
function setServiceKey() {
  var KEY = 'PASTE-A-LONG-RANDOM-KEY-HERE';
  if (KEY === 'PASTE-A-LONG-RANDOM-KEY-HERE' || KEY.length < 32) throw new Error('Replace the placeholder with a random key of at least 32 characters, then run again.');
  PropertiesService.getScriptProperties().setProperty('SERVICE_KEY_HASH', sha256_(KEY));
  console.log('Service key saved.');
}

function requireService_(key) {
  var p = PropertiesService.getScriptProperties().getProperties();
  if (!p.SERVICE_KEY_HASH) throw err_('not_set', 'The portal service key has not been set. In Apps Script, run setServiceKey().');
  if (!safeEq_(sha256_(String(key || '')), p.SERVICE_KEY_HASH)) throw err_('unauthorized', 'Not allowed.');
}

/** Run once after updating this script: adds "Work in Progress" to the Quote Status dropdown and colours of existing sheets. */
function refreshStatusOptions() {
  var ss = getSpreadsheet_();
  ['quote', 'contact'].forEach(function (type) {
    var sheet = ensureSheet_(ss, type), map = headerMap_(sheet);
    if (!map['Quote Status']) return;
    var rows = Math.max(sheet.getMaxRows() - 1, 1);
    var range = sheet.getRange(2, map['Quote Status'], rows, 1);
    range.setDataValidation(statusRule_());
    if (type === 'quote') {
      var colours = { 'New': '#FDECC0', 'Contacted': '#DCE8F7', 'Site Visit Scheduled': '#E3DAF5', 'Quote Sent': '#D4EEF2', 'Accepted': '#D5EDD9',
                      'Work in Progress': '#FBE3B8', 'Declined': '#F6D8D6', 'Completed': '#E4E4E4' };
      sheet.setConditionalFormatRules(CONFIG.STATUS_OPTIONS.map(function (s) {
        return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(colours[s] || '#EEEEEE').setRanges([range]).build();
      }));
    }
  });
  console.log('Status dropdown updated.');
}

function requireAdmin_(token) {
  var p = PropertiesService.getScriptProperties().getProperties();
  var parts = String(token || '').split('.');
  if (!p.ADMIN_SECRET || parts.length !== 2 || !/^\d+$/.test(parts[0])) throw err_('unauthorized', 'Please sign in.');
  if (Number(parts[0]) < Date.now()) throw err_('unauthorized', 'Your session expired. Please sign in again.');
  if (!safeEq_(hmac_(parts[0], p.ADMIN_SECRET), parts[1])) throw err_('unauthorized', 'Please sign in.');
}

function rowToObject_(headers, values, rowNumber) {
  var o = { _row: rowNumber };
  headers.forEach(function (h, j) {
    if (h === '' || h === null) return;
    var v = values[j];
    if (v instanceof Date) v = (h === 'Work Start Date') ? Utilities.formatDate(v, CONFIG.TIMEZONE, 'yyyy-MM-dd') : v.toISOString();
    o[String(h)] = v;
  });
  return o;
}

function readRecords_(sheet, limit) {
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var start = Math.max(2, lastRow - limit + 1);
  var vals = sheet.getRange(start, 1, lastRow - start + 1, lastCol).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    if (r.every(function (c) { return c === '' || c === null; })) return;     // skip empty rows
    var rec = rowToObject_(headers, r, start + i);
    if (!rec['Reference']) rec['Reference'] = 'ROW-' + (start + i);          // rows added by hand
    out.push(rec);
  });
  return out;
}

function adminList_() {
  var ss = getSpreadsheet_();
  var quoteSheet = ensureSheet_(ss, 'quote');
  if (needsTokens_(quoteSheet)) {                                  // e.g. rows added by hand
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { backfillTokens_(quoteSheet); } finally { lock.releaseLock(); }
  }
  return {
    ok: true,
    priceVisibleStatuses: CONFIG.PRICE_VISIBLE_STATUSES,
    quotes:   readRecords_(quoteSheet, 3000),
    contacts: readRecords_(ensureSheet_(ss, 'contact'), 3000),
    statusOptions: CONFIG.STATUS_OPTIONS,
    serverTime: new Date().toISOString()
  };
}

function cleanAdminValue_(h, v) {
  if (h === 'Quote Status') {
    v = str_(v, 40);
    if (CONFIG.STATUS_OPTIONS.indexOf(v) === -1) throw err_('bad_value', 'Please pick a status from the list.');
    return v;
  }
  if (h === 'Actual Price') {
    if (v === '' || v === null || v === undefined) return '';
    var n = Number(String(v).replace(/[$,\s]/g, ''));
    if (!isFinite(n) || n < 0 || n > 100000000) throw err_('bad_value', 'Enter the price as a number, for example 12500 or 12500.50.');
    return Math.round(n * 100) / 100;
  }
  if (h === 'Work Start Date') {
    v = str_(v, 20);
    if (v === '') return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    var dt = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!dt || dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3] || +m[1] < 2000 || +m[1] > 2100) {
      throw err_('bad_value', 'Please enter a valid start date.');
    }
    return v;                                                    // stored as plain text: YYYY-MM-DD
  }
  var s = str_(v, FIELD_MAX[h] || 200, h === 'Notes' || h === 'Internal Notes' || h === 'Client Message');
  if (h === 'Name' && !s) throw err_('bad_value', 'Name cannot be empty.');
  if (h === 'Email') {
    try { requireEmail_(s); } catch (e) { throw err_('bad_value', 'Please enter a valid email address.'); }
  }
  return s;
}

function locateRow_(sheet, map, ref, hintRow) {
  var refCol = map['Reference'];
  var last = sheet.getLastRow();
  if (!refCol || !ref) throw err_('not_found', 'Record not found. Refresh and try again.');
  if (hintRow >= 2 && hintRow <= last && String(sheet.getRange(hintRow, refCol).getValue()) === ref) return hintRow;
  var vals = sheet.getRange(1, refCol, last, 1).getValues();     // rows may have moved: search by reference
  for (var i = vals.length - 1; i >= 1; i--) if (String(vals[i][0]) === ref) return i + 1;
  if (/^ROW-\d+$/.test(ref)) {
    var r = Number(ref.slice(4));
    if (r >= 2 && r <= last) return r;
  }
  throw err_('not_found', 'That record is no longer in the sheet (was it deleted?). Refresh and try again.');
}

function adminUpdate_(data) {
  var type = data.tab === 'contact' ? 'contact' : 'quote';
  var fields = data.fields && typeof data.fields === 'object' ? data.fields : {};
  var names = Object.keys(fields);
  if (!names.length) throw err_('nothing', 'Nothing to save.');

  var clean = {};
  names.forEach(function (h) {
    if (EDITABLE_FIELDS[type].indexOf(h) === -1) throw err_('forbidden', 'The field "' + h + '" cannot be edited.');
    clean[h] = cleanAdminValue_(h, fields[h]);
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ensureSheet_(getSpreadsheet_(), type);
    var map = headerMap_(sheet);
    var row = locateRow_(sheet, map, String(data.ref || ''), Number(data.row) || 0);
    names.forEach(function (h) {
      if (!map[h]) throw err_('missing_column', 'The column "' + h + '" is missing from the sheet. Run setup() again.');
    });
    names.forEach(function (h) { sheet.getRange(row, map[h]).setValue(clean[h]); });
    SpreadsheetApp.flush();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    return { ok: true, record: rowToObject_(headers, values, row) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================
 *  CUSTOMER TRACKING PAGE API  (used by track.html)
 * ============================================================================
 *  Each quote gets a random, unguessable Tracking Token. The emailed link is the
 *  key: whoever holds it sees THAT request only. The lookup returns a fixed,
 *  short list of safe fields. Internal notes, other customers, and the
 *  admin tools are never reachable from it.
 * ========================================================================== */

function newToken_() { return Utilities.getUuid().replace(/-/g, ''); }        // 32 random hex characters

function trackUrl_(token) {
  var base = CONFIG.TRACK_URL || (CONFIG.WEBSITE_URL ? CONFIG.WEBSITE_URL.replace(/\/+$/, '') + '/track.html' : '');
  return base ? base + '?k=' + token : '';
}

/** True if any quote row is missing its tracking token. */
function needsTokens_(sheet) {
  var map = headerMap_(sheet), last = sheet.getLastRow();
  if (!map['Tracking Token'] || last < 2) return false;
  var refs = sheet.getRange(2, map['Reference'], last - 1, 1).getValues();
  var names = map['Name'] ? sheet.getRange(2, map['Name'], last - 1, 1).getValues() : refs;
  var toks = sheet.getRange(2, map['Tracking Token'], last - 1, 1).getValues();
  for (var i = 0; i < refs.length; i++) if ((refs[i][0] !== '' || names[i][0] !== '') && !toks[i][0]) return true;
  return false;
}

/** Gives every row without a token one. Call while holding the script lock. */
function backfillTokens_(sheet) {
  var map = headerMap_(sheet), last = sheet.getLastRow();
  if (!map['Tracking Token'] || last < 2) return 0;
  var n = sheet.getLastColumn(), col = map['Tracking Token'] - 1;
  var all = sheet.getRange(2, 1, last - 1, n).getValues();
  var out = [], added = 0;
  all.forEach(function (r) {
    var hasData = r.some(function (c, j) { return j !== col && c !== '' && c !== null; });
    var t = r[col];
    if (hasData && !t) { t = newToken_(); added++; }
    out.push([t]);
  });
  if (added) sheet.getRange(2, map['Tracking Token'], out.length, 1).setValues(out);
  return added;
}

function trackLookup_(token) {
  token = String(token || '').toLowerCase();
  var notFound = function () { return err_('not_found', 'We could not find that request. Please use the link from your email.'); };
  if (!/^[a-f0-9]{32}$/.test(token)) throw notFound();

  var sheet = ensureSheet_(getSpreadsheet_(), 'quote');
  var map = headerMap_(sheet), last = sheet.getLastRow();
  if (!map['Tracking Token'] || last < 2) throw notFound();

  var toks = sheet.getRange(2, map['Tracking Token'], last - 1, 1).getValues();
  var row = 0;
  for (var i = 0; i < toks.length; i++) {
    var t = String(toks[i][0] || '').toLowerCase();
    if (t.length === 32 && safeEq_(t, token)) { row = i + 2; break; }
  }
  if (!row) throw notFound();

  var lastCol = sheet.getLastColumn();
  var r = rowToObject_(sheet.getRange(1, 1, 1, lastCol).getValues()[0], sheet.getRange(row, 1, 1, lastCol).getValues()[0], row);

  var status = r['Quote Status'] || CONFIG.STATUS_OPTIONS[0];
  var price = Number(r['Actual Price']);
  var showPrice = CONFIG.PRICE_VISIBLE_STATUSES.indexOf(status) !== -1 && r['Actual Price'] !== '' && isFinite(price);

  // Fixed whitelist: nothing else from the row is ever returned.
  return {
    ok: true,
    request: {
      reference: r['Reference'],
      name: r['Name'],
      submittedAt: r['Submitted At'],
      status: status,
      items: list_(r['Selected Items']),
      siteVisitItems: list_(r['Site-Visit Items']),
      estimateRange: r['Estimate Range (shown to customer)'],
      address: r['Property Address'], city: r['City'], zip: r['ZIP'],
      propertyType: r['Property Type'], finishLevel: r['Finish Level'], timeline: r['Start Timeline'],
      insuranceClaim: r['Insurance Claim'], bestTime: r['Best Time to Reach'],
      notes: r['Notes'],
      workStartDate: r['Work Start Date'] || '',
      message: r['Client Message'] || '',
      actualPrice: showPrice ? price : null
    },
    company: { name: CONFIG.COMPANY_NAME, phone: CONFIG.PHONE_DISPLAY, phoneTel: CONFIG.PHONE_TEL, email: CONFIG.PUBLIC_EMAIL, address: CONFIG.ADDRESS },
    serverTime: new Date().toISOString()
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
