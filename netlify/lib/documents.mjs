// Receipts and supporting documents.
// Files are stored in private Netlify Blobs. The only way to read one is GET /api/documents/:id/download,
// which re-checks the signed-in user's access to that project on every request.
import crypto from 'node:crypto';
import { HttpError } from './http.mjs';
import { cleanFields, failIfErrors } from './fields.mjs';
import { writeAudit } from './audit.mjs';
import { getProjectRow, trackerVisibleFor } from './projects.mjs';

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // keeps the base64 request under the 6 MB function limit
const KINDS = ['receipt', 'supporting', 'contract', 'other'];

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
const ascii = (buf, from, to) => buf.subarray(from, to).toString('latin1');
const looksLikeText = (buf) => {
  const head = buf.subarray(0, 4096);
  if (head.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(head); return true; } catch { return false; }
};
// Allowed types: the extension must match the real file contents (not what the browser claims).
export const FILE_TYPES = {
  pdf: { type: 'application/pdf', ok: (b) => ascii(b, 0, 5) === '%PDF-' },
  png: { type: 'image/png', ok: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { type: 'image/jpeg', ok: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { type: 'image/jpeg', ok: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  webp: { type: 'image/webp', ok: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ok: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ok: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  csv: { type: 'text/csv; charset=utf-8', ok: looksLikeText },
  txt: { type: 'text/plain; charset=utf-8', ok: looksLikeText }
};

export function safeFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>:*?|]/g, '').trim();
  return base.slice(-150) || 'document';
}

const META = {
  title: { kind: 'text', max: 200, required: true },
  kind: { kind: 'enum', values: KINDS, required: true },
  linkedType: { kind: 'enum', values: ['expense', 'supplement', 'draw'] },
  linkedId: { kind: 'text', max: 40 }
};
const LINK_TABLE = { expense: 'expenses', supplement: 'supplements', draw: 'draws' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadDocument(db, store, actor, projectId, body) {
  const { clean, errors } = cleanFields(body, META);
  if (!clean.linkedType) delete clean.linkedType;
  if (clean.linkedType && !clean.linkedId) errors.linkedId = 'Choose the record this file belongs to.';
  if (!clean.linkedType && clean.linkedId) errors.linkedType = 'Choose what this file belongs to.';
  if (clean.linkedId && !UUID.test(clean.linkedId)) errors.linkedId = 'That record was not found on this project.';
  const fileName = safeFileName(body.fileName);
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const spec = FILE_TYPES[ext];
  if (!spec) errors.file = 'That file type is not allowed. Use PDF, PNG, JPG, WEBP, DOCX, XLSX, CSV or TXT.';
  if (typeof body.dataBase64 !== 'string' || !body.dataBase64) errors.file = 'Choose a file to upload.';
  failIfErrors(errors);
  if (body.dataBase64.length > Math.ceil(MAX_FILE_BYTES * 1.4)) throw new HttpError(413, 'too_large', 'That file is too large. The limit is 4 MB.', { file: 'The limit is 4 MB per file.' });
  const bytes = Buffer.from(body.dataBase64, 'base64');
  if (!bytes.length) throw new HttpError(400, 'validation', 'That file is empty.', { file: 'That file is empty.' });
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'too_large', 'That file is too large. The limit is 4 MB.', { file: 'The limit is 4 MB per file.' });
  if (!spec.ok(bytes)) throw new HttpError(400, 'validation', `That file does not look like a real .${ext} file.`, { file: `That file does not look like a real .${ext} file.` });

  const project = await getProjectRow(db, projectId);
  if (clean.linkedType) {
    const found = await db.query(`SELECT 1 FROM ${LINK_TABLE[clean.linkedType]} WHERE id = $1 AND project_id = $2`, [clean.linkedId, projectId]);
    if (!found.length) throw new HttpError(400, 'validation', 'That record was not found on this project.', { linkedId: 'That record was not found on this project.' });
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const blobKey = `${projectId}/${crypto.randomUUID()}`;
  await store.set(blobKey, bytes, { metadata: { projectId, sha256 } });
  try {
    return await db.tx(async (q) => {
      const [r] = await q.query(
        `INSERT INTO documents (project_id, kind, title, file_name, content_type, size_bytes, sha256, blob_key, linked_type, linked_id, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, uploaded_at::text AS uploaded_at`,
        [projectId, clean.kind, clean.title, fileName, spec.type, bytes.length, sha256, blobKey, clean.linkedType || null, clean.linkedType ? clean.linkedId : null, actor.email]);
      await writeAudit(q, actor, { action: 'document.upload', entityType: 'document', entityId: r.id, projectId,
        summary: `Uploaded ${clean.kind} "${clean.title}" (${fileName}) to ${project.code}`,
        after: { title: clean.title, kind: clean.kind, fileName, sizeBytes: bytes.length, sha256, linkedType: clean.linkedType || null, linkedId: clean.linkedType ? clean.linkedId : null } });
      return { id: r.id, kind: clean.kind, title: clean.title, fileName, contentType: spec.type, sizeBytes: bytes.length, linkedType: clean.linkedType || null, linkedId: clean.linkedType ? clean.linkedId : null, uploadedAt: r.uploaded_at };
    });
  } catch (err) {
    try { await store.delete(blobKey); } catch { /* best effort: do not leave an orphan file */ }
    throw err;
  }
}

export async function downloadDocument(db, store, user, id) {
  const [d] = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
  if (!d) throw new HttpError(404, 'not_found', 'That document was not found.');
  if (user.role !== 'admin') {
    const [m] = await db.query('SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND email = $2', [d.project_id, user.email]);
    const project = m ? await getProjectRow(db, d.project_id) : null;
    // Same answer as "does not exist" for anyone who may not see it.
    if (!m || !trackerVisibleFor(project)) throw new HttpError(404, 'not_found', 'That document was not found.');
  }
  const data = await store.get(d.blob_key, { type: 'arrayBuffer' });
  if (!data) throw new HttpError(404, 'file_missing', 'The file for this document could not be found. Please tell FCV Restoration & Construction.');
  await db.tx((q) => writeAudit(q, user, { action: 'document.download', entityType: 'document', entityId: d.id, projectId: d.project_id, summary: `Downloaded "${d.title}" (${d.file_name})` }));
  const encoded = encodeURIComponent(d.file_name).replace(/['()]/g, escape);
  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': d.content_type,
      'Content-Length': String(data.byteLength),
      'Content-Disposition': `attachment; filename="${d.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encoded}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
    }
  });
}

export async function deleteDocument(db, store, actor, id) {
  const key = await db.tx(async (q) => {
    const [d] = await q.query('SELECT * FROM documents WHERE id = $1', [id]);
    if (!d) throw new HttpError(404, 'not_found', 'That document was not found.');
    await q.query('DELETE FROM documents WHERE id = $1', [id]);
    await writeAudit(q, actor, { action: 'document.delete', entityType: 'document', entityId: id, projectId: d.project_id,
      summary: `Deleted ${d.kind} "${d.title}" (${d.file_name})`,
      before: { title: d.title, kind: d.kind, fileName: d.file_name, sizeBytes: Number(d.size_bytes), sha256: d.sha256, linkedType: d.linked_type, linkedId: d.linked_id } });
    return d.blob_key;
  });
  try { await store.delete(key); } catch { /* the row is gone; an unreachable private orphan is harmless */ }
  return { deleted: true };
}
