#!/usr/bin/env node
/*
 * check-702 - does the app downport to NetWeaver 7.02?
 *
 * abap2UI5 runs from 7.02 on, as a downported release (`<n>-702`).
 * `abaplint --fix` against .github/abaplint/abap_702.jsonc lowers the newer
 * syntax an app is written in (inline declarations, VALUE #( ), string
 * templates, ...) - and rewrites every file while it does, so this never
 * runs on your tree: it copies src/ into a temporary folder, downports the
 * copy, lints the result at v702 and throws the copy away. 0 issues, or exit
 * 1 with what has no 7.02 form.
 *
 *   node scripts/check-702.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = '.github/abaplint/abap_702.jsonc';
const abaplint = path.join(ROOT, 'node_modules', '.bin', 'abaplint');
if (!fs.existsSync(abaplint)) {
  console.error('check-702: abaplint is not installed - run npm ci first');
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abap2ui5-app-702-'));
let status = 1;
try {
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, CONFIG), path.join(dir, CONFIG), { recursive: true });
  const run = (args) => spawnSync(abaplint, args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  // --fix lowers what it can; what it cannot stays an issue for the lint below
  run(['--fix', CONFIG]);
  const lint = run([CONFIG]);
  process.stdout.write(`${lint.stdout}${lint.stderr}`.split('\n').filter((l) => /\[E\]|\[W\]|issue\(s\) found/.test(l)).join('\n') + '\n');
  status = lint.status ?? 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
if (status !== 0) console.error('check-702: the downported app does not lint at v702 - see above');
process.exit(status === 0 ? 0 : 1);
