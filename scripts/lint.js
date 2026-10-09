// scripts/lint.js — run `node --check` over every project source file.
//
// Usage: node scripts/lint.js
//
// The old `npm run lint` only checked index.js, so a syntax error in any
// command/event/util could ship. This walks the source tree and exits non-zero
// on the first failure, printing the offending file.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['commands', 'events', 'handlers', 'utils', 'tasks', 'config'];
const EXTRA = ['index.js'];

function collectJs(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));
}

const files = []
  .concat(...DIRS.map(collectJs))
  .concat(EXTRA)
  .filter(Boolean);

let failures = 0;
for (const rel of files) {
  try {
    execFileSync('node', ['--check', path.join(ROOT, rel)], { stdio: 'ignore' });
    process.stdout.write(`ok   ${rel}\n`);
  } catch (err) {
    failures++;
    process.stderr.write(`FAIL ${rel}\n`);
    if (err.stderr) process.stderr.write(err.stderr.toString());
  }
}

process.stderr.write(`\n${files.length} file(s) checked, ${failures} failure(s).\n`);
process.exit(failures ? 1 : 0);