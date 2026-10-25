// Small HTTP helpers shared by every endpoint.
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Every API response is private: never cached by the browser, a CDN or a proxy.
export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE_HEADERS, ...extra }
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, details: err.details || undefined } }, err.status);
  }
  // Never leak internals to the browser.
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  return json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } }, 500);
}

export async function readJson(req, maxBytes = 64 * 1024) {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send the request as JSON.');
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'too_large', 'That request is too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'That request is too large.');
  let body;
  try { body = JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'bad_json', 'The request was not valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'Send a JSON object.');
  return body;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function mustUuid(value, what = 'id') {
  if (!UUID.test(String(value || ''))) throw new HttpError(404, 'not_found', `That ${what} was not found.`);
  return String(value).toLowerCase();
}

// Tiny path router: '/api/projects/:id/expenses/:rid'
export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      const keys = [];
      const re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
      routes.push({ method, re, keys, handler });
    },
    match(method, path) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
        return { handler: r.handler, params };
      }
      return { handler: null, pathMatched };
    }
  };
}
