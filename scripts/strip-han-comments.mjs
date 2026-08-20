import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, 'scripts', 'han-residual-report.txt');
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
    if (ch === '\\' && i + 1 < source.length) {
      out += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === quote) {
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

function asciiEscape(value) {
  return Array.from(value).map((char) => {
    const codePoint = char.codePointAt(0);
    return codePoint > 0x7f ? `\\u{${codePoint.toString(16)}}` : char;
  }).join('');
}

const files = walk(ROOT).filter(path => path !== REPORT_PATH);
const residual = [];
let changed = 0;

for (const path of files) {
  const rel = relative(ROOT, path).replaceAll('\\', '/');
  const source = readFileSync(path, 'utf8');
  let next = source;

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

const report = residual.length
  ? residual.map(asciiEscape).join('\n') + '\n'
  : 'No Han text remains.\n';
writeFileSync(REPORT_PATH, report);

console.log(`English cleanup updated ${changed} file(s).`);
console.log(residual.length ? `Remaining Han lines: ${residual.length}` : 'No Han text remains.');
