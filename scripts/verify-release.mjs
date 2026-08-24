import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = join(root, 'release');

const required = [
  'manifest.json',
  'dist/edit-pagination-compat.js',
  'dist/docked-panel.js',
  'dist/docked-panel.css',
  'dist/content.js',
  'dist/background.js',
  'dist/popup.js',
  'dist/setup.js',
  'dist/sidepanel.js',
  'dist/sidepanel.css',
  'src/popup/index.html',
  'src/setup/index.html',
  'src/sidepanel/index.html'
];

const forbidden = [
  '_locales',
  'dist/docked-panel-theme.css',
  'dist/chatgpt-theme.css',
  'dist/graph-ux.css'
];

for (const relativePath of required) {
  assert.equal(existsSync(join(release, relativePath)), true, `missing release path: ${relativePath}`);
}
for (const relativePath of forbidden) {
  assert.equal(existsSync(join(release, relativePath)), false, `obsolete release path: ${relativePath}`);
}

const manifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal('default_locale' in manifest, false);
assert.equal('side_panel' in manifest, false);
assert.equal((manifest.permissions || []).includes('sidePanel'), false);

console.log('Release package verification passed.');
