// Connector to the existing Google Sheet of quote requests (Apps Script web app).
// The browser never talks to Apps Script: only this server does, using a secret key stored as a Netlify environment variable.
import { HttpError } from './http.mjs';

async function call(action, payload = {}) {
  const url = process.env.FCV_SHEET_ENDPOINT; const key = process.env.FCV_SHEET_SERVICE_KEY;
  if (!url || !key) throw new HttpError(503, 'sheet_not_configured', 'The quote-request sheet is not connected yet. Set FCV_SHEET_ENDPOINT and FCV_SHEET_SERVICE_KEY.');
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, serviceKey: key, ...payload }), redirect: 'follow' });
  } catch { throw new HttpError(502, 'sheet_unreachable', 'Could not reach the quote-request sheet.'); }
  let data;
  try { data = await res.json(); } catch { throw new HttpError(502, 'sheet_bad_response', 'The quote-request sheet sent an unexpected response.'); }
  if (!data || data.ok !== true) throw new HttpError(502, 'sheet_error', (data && data.error) || 'The quote-request sheet reported an error.');
  return data;
}

export const sheetList = () => call('svc_list');
export const sheetUpdate = (tab, ref, row, fields) => call('svc_update', { tab, ref, row, fields });

export const STAGE_TO_STATUS = {
  new: 'New', contacted: 'Contacted', site_visit: 'Site Visit Scheduled', quote_sent: 'Quote Sent', accepted: 'Accepted',
  work_in_progress: 'Work in Progress', completed: 'Completed', declined: 'Declined'
};
export const STATUS_TO_STAGE = Object.fromEntries(Object.entries(STAGE_TO_STATUS).map(([k, v]) => [v, k]));

// Fields the admin may change on a quote request from the portal (mirrors the Apps Script allow-list).
export const REQUEST_EDITABLE = ['Name', 'Phone', 'Email', 'Best Time to Reach', 'Property Address', 'City', 'ZIP', 'Property Type', 'Finish Level',
  'Start Timeline', 'Insurance Claim', 'Notes', 'Quote Status', 'Actual Price', 'Internal Notes', 'Work Start Date', 'Client Message'];
