import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const HAN = /\p{Script=Han}/u;
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.jsx', '.css', '.html', '.md', '.json', '.yml', '.yaml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'release', 'release-screenshots']);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, files);
    else if (TEXT_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

function stripJsLikeComments(source) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = '';

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '"' || ch === "'" || ch === '`') {
        state = 'string';
        quote = ch;
        out += ch;
        i += 1;
        continue;
      }

      if (ch === '/' && next === '/') {
        const end = source.indexOf('\n', i + 2);
        const stop = end === -1 ? source.length : end;
        const comment = source.slice(i, stop);
        if (!HAN.test(comment)) out += comment;
        i = stop;
        continue;
      }

      if (ch === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? source.length : end + 2;
        const comment = source.slice(i, stop);
        if (!HAN.test(comment)) out += comment;
        i = stop;
        continue;
      }

      out += ch;
      i += 1;
      continue;
    }

    out += ch;
    if (ch === '\\') {
      if (i + 1 < source.length) {
        out += source[i + 1];
        i += 2;
        continue;
      }
    } else if (ch === quote) {
      state = 'code';
      quote = '';
    }
    i += 1;
  }

  return out;
}

function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, comment => HAN.test(comment) ? '' : comment);
}

const files = walk(ROOT);
const residual = [];
let changed = 0;

for (const path of files) {
  const rel = relative(ROOT, path).replaceAll('\\', '/');
  let source = readFileSync(path, 'utf8');
  let next = source;

  // These two labels were legacy multilingual fallbacks. The navigator also has
  // semantic English labels and an ID/position fallback, so removing them does
  // not change branch-switch behavior for the supported UI.
  if (rel === 'src/content/utils/branch-navigator.js') {
    next = next.replace('|上一', '').replace('|下一', '');
  }

  const ext = extname(path);
  if (['.js', '.mjs', '.jsx', '.css'].includes(ext)) {
    next = stripJsLikeComments(next);
  } else if (ext === '.html' || ext === '.md') {
    next = stripHtmlComments(next);
  }

  if (next !== source) {
    writeFileSync(path, next);
    changed += 1;
  }

  next.split(/\r?\n/).forEach((line, index) => {
    if (HAN.test(line)) residual.push(`${rel}:${index + 1}: ${line.trim()}`);
  });
}

console.log(`English cleanup updated ${changed} file(s).`);
if (residual.length) {
  console.log('Remaining Han text requires manual review:');
  residual.forEach(line => console.log(line));
} else {
  console.log('No Han text remains.');
}
