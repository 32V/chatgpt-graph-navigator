/**
 * Build and package a production release.
 * Usage: npm run release
 */

import { execSync } from 'child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;
const RELEASE_DIR = join(ROOT, 'release');
const ZIP_NAME = `chatgpt-graph-extension-v${VERSION}.zip`;

const FILES_TO_INCLUDE = [
  'manifest.json',
  'dist',
  'src/popup/index.html',
  'src/sidepanel/index.html',
  'src/setup/index.html',
  'assets'
];

async function main() {
  console.log(`\nBuilding release v${VERSION}...\n`);

  execSync('npm run build:release', { cwd: ROOT, stdio: 'inherit' });

  if (existsSync(RELEASE_DIR)) rmSync(RELEASE_DIR, { recursive: true });
  mkdirSync(RELEASE_DIR, { recursive: true });

  for (const file of FILES_TO_INCLUDE) {
    const src = join(ROOT, file);
    if (!existsSync(src)) throw new Error(`Required release path is missing: ${file}`);
    const dest = join(RELEASE_DIR, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyRecursive(src, dest);
  }

  const zipPath = join(ROOT, ZIP_NAME);
  if (existsSync(zipPath)) rmSync(zipPath);
  await createZip(RELEASE_DIR, zipPath);

  console.log(`Release ready: ${RELEASE_DIR}`);
  console.log(`Archive: ${ZIP_NAME}`);
}

function copyRecursive(src, dest) {
  const stat = statSync(src);

  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const child of readdirSync(src)) {
      copyRecursive(join(src, child), join(dest, child));
    }
    return;
  }

  copyFileSync(src, dest);
}

function createZip(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const size = (archive.pointer() / 1024).toFixed(1);
      console.log(`${basename(outPath)} (${size} KB)`);
      resolve();
    });
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

main().catch((error) => {
  console.error('Release failed:', error);
  process.exit(1);
});
