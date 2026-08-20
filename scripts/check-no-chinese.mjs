import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const ALLOWED_EXTENSIONS = new Set([
  '.js', '.mjs', '.jsx', '.css', '.html', '.json', '.md', '.yml', '.yaml'
]);
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'release', 'release-screenshots'
]);
const HAN_RE = /\p{Script=Han}/u;

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...await collectFiles(full));
      continue;
    }
    if (ALLOWED_EXTENSIONS.has(extname(entry.name))) files.push(full);
  }
  return files;
}

const failures = [];
for (const file of await collectFiles(ROOT)) {
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!HAN_RE.test(lines[index])) continue;
    failures.push({
      file: relative(ROOT, file),
      line: index + 1,
      text: lines[index].trim().slice(0, 180)
    });
  }
}

if (failures.length > 0) {
  console.error('Chinese/Han characters remain in tracked source or documentation:');
  for (const failure of failures) {
    console.error(`${failure.file}:${failure.line}: ${failure.text}`);
  }
  process.exit(1);
}

console.log('English-only source/documentation check passed.');
