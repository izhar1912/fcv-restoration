// Private file storage (receipts, supporting documents) in Netlify Blobs.
// Blobs are never public: the only way to read one is through the permission-checked download endpoint.
import { getStore } from '@netlify/blobs';

export function docStore(context) {
  const test = globalThis.__FCV_TEST__ && globalThis.__FCV_TEST__.blobs;
  if (test) return test;
  // Deploy previews use a separate store so testing can never touch production files.
  const isProd = context && context.deploy && context.deploy.context === 'production';
  return getStore({ name: isProd ? 'fcv-documents' : 'fcv-documents-preview', consistency: 'strong' });
}
