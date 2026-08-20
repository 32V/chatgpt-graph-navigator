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

const FILES_TO_INCLUDE = [
  'manifest.json',
  'dist',
  'src/popup/index.html',
  'src/sidepanel/index.html',
  'src/setup/index.html',
  'assets',
  '_locales'
];

const EXCLUDE_FILES = [
  'icon1024.png'
];

const SCREENSHOTS_DIR = join(ROOT, 'docs', 'pic');
const SCREENSHOTS = [
  'float_main.png',
  'main_feature.png'
];

const RELEASE_DIR = join(ROOT, 'release');
const SCREENSHOTS_OUT_DIR = join(ROOT, 'release-screenshots');
const ZIP_NAME = `chatgpt-graph-extension-v${VERSION}.zip`;

async function main() {
  console.log(`\n📦 Building release v${VERSION}...\n`);

  console.log('1. Building production bundles...');
  try {
    execSync('npm run build:release', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('× Build failed');
    process.exit(1);
  }

  console.log('\n2. Preparing release directory...');
  if (existsSync(RELEASE_DIR)) {
    rmSync(RELEASE_DIR, { recursive: true });
  }
  mkdirSync(RELEASE_DIR, { recursive: true });

  console.log('3. Copying extension files...');
  for (const file of FILES_TO_INCLUDE) {
    const src = join(ROOT, file);
    const dest = join(RELEASE_DIR, file);

    if (!existsSync(src)) {
      console.warn(`   ⚠ Skipping missing path: ${file}`);
      continue;
    }

    mkdirSync(dirname(dest), { recursive: true });
    copyRecursive(src, dest);
    console.log(`   ✓ ${file}`);
  }

  console.log('4. Copying Chrome Web Store screenshots...');
  if (existsSync(SCREENSHOTS_OUT_DIR)) {
    rmSync(SCREENSHOTS_OUT_DIR, { recursive: true });
  }
  mkdirSync(SCREENSHOTS_OUT_DIR, { recursive: true });

  for (const screenshot of SCREENSHOTS) {
    const src = join(SCREENSHOTS_DIR, screenshot);
    const dest = join(SCREENSHOTS_OUT_DIR, screenshot);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`   ✓ ${screenshot}`);
    } else {
      console.warn(`   ⚠ Skipping missing screenshot: ${screenshot}`);
    }
  }

  console.log('\n5. Creating ZIP archive...');
  const zipPath = join(ROOT, ZIP_NAME);
  await createZip(RELEASE_DIR, zipPath);

  console.log('\n✅ Release complete!');
  console.log('   📁 Extension: release/');
  console.log(`   📦 Archive: ${ZIP_NAME}`);
  console.log('   🖼️  Screenshots: release-screenshots/');
  console.log(`\n   Upload ${ZIP_NAME} to the Chrome Web Store when publishing.\n`);
}

function copyRecursive(src, dest) {
  const stat = statSync(src);

  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const child of readdirSync(src)) {
      if (EXCLUDE_FILES.includes(child)) {
        console.log(`   ⊘ Excluded: ${child}`);
        continue;
      }
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
      console.log(`   ✓ ${basename(outPath)} (${size} KB)`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

main().catch(console.error);
