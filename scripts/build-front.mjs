// Bundles the official Netlify Identity SDK into portal/assets/identity.js (one small file, no CDN needed).
// Run:  npm run build:front       (the built file is committed, so Netlify does not need to run this)
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = process.argv.includes('--mock');       // test-only build against a fake Identity server
await build({
  entryPoints: [path.join(root, 'src/identity-bridge.js')],
  outfile: path.join(root, mock ? 'test/e2e/.built/identity.js' : 'portal/assets/identity.js'),
  bundle: true, minify: true, format: 'iife', target: 'es2020', platform: 'browser', legalComments: 'none',
  alias: mock ? { '@netlify/identity': path.join(root, 'test/e2e/identity-browser-mock.js') } : {}
});
console.log(mock ? 'built TEST identity bundle' : 'built portal/assets/identity.js');
