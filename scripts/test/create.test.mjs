/*
 * create/ - the `npm create abap2ui5-app` package - has to produce the project
 * "Use this template" + scripts/rename.mjs produces. Same template.json, same
 * substitution code (a byte-equal copy), so the way to know is to run both
 * and compare the trees.
 *
 *   node --test scripts/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, targetProblem } from '../../create/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'template.json'), 'utf8'));
const CREATE = path.join(ROOT, 'create/index.mjs');

const ARGS = { cls: 'zcl_probe_app', pkg: 'Probe App', repo: 'probe-repo' };

const run = (args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

/** Every file under `dir`, relative, sorted. */
const tree = (dir) => {
  const out = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, '');
  return out;
};

const copy = (rel, into) => {
  fs.mkdirSync(path.join(into, path.dirname(rel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), path.join(into, rel));
};

test('create: --from this checkout equals "Use this template" + rename.mjs, byte for byte', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-create-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  // A: the package, reading this checkout
  const a = path.join(base, 'a');
  const created = run([CREATE, a, '--class', ARGS.cls, '--package', ARGS.pkg, '--repo', ARGS.repo, '--from', ROOT]);
  assert.equal(created.code, 0, created.out);

  // B: what "Use this template" hands out (shared + named), renamed in place
  // by the real rename.mjs - which needs template.json and its library next
  // to it, so those ride along and are removed before the comparison.
  const b = path.join(base, 'b');
  const helpers = ['template.json', 'scripts/rename.mjs', 'scripts/lib/substitute.mjs'];
  for (const rel of [...SPEC.files.shared, ...SPEC.files.named, ...helpers]) copy(rel, b);
  const renamed = run([path.join(b, 'scripts/rename.mjs'), '--class', ARGS.cls, '--package', ARGS.pkg, '--repo', ARGS.repo], { cwd: b });
  assert.equal(renamed.code, 0, renamed.out);
  for (const rel of helpers) fs.rmSync(path.join(b, rel));
  fs.rmSync(path.join(b, 'scripts/lib'), { recursive: true, force: true });

  assert.deepEqual(tree(a), tree(b), 'the two ways produce different file lists');
  for (const rel of tree(a)) {
    const [x, y] = [fs.readFileSync(path.join(a, rel)), fs.readFileSync(path.join(b, rel))];
    assert.ok(x.equals(y), `${rel} differs between npm create and rename.mjs`);
  }

  // and the result is the personalised project, sidecar BOM intact
  const xml = fs.readFileSync(path.join(a, `src/${ARGS.cls}.clas.xml`));
  assert.deepEqual([...xml.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(xml.toString('utf8'), new RegExp(`<CLSNAME>${ARGS.cls.toUpperCase()}</CLSNAME>`));
  assert.match(fs.readFileSync(path.join(a, 'src/package.devc.xml'), 'utf8'), /<CTEXT>Probe App<\/CTEXT>/);
  assert.match(fs.readFileSync(path.join(a, '.abapgit.xml'), 'utf8'), /<NAME>probe-repo<\/NAME>/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a, 'package.json'), 'utf8')).name, 'probe-repo');
  assert.ok(fs.existsSync(path.join(a, `src/${ARGS.cls}.clas.testclasses.abap`)), 'the test include was not renamed with the class');
  assert.ok(!fs.existsSync(path.join(a, 'template.json')), 'a project does not get template.json');
});

test('create: refuses a class name the template refuses, and a directory that is not empty', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-create-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const bad of ['ycl_my_app', 'my_app', 'zcl_' + 'x'.repeat(40)]) {
    const r = run([CREATE, path.join(base, 'x'), '--class', bad, '--from', ROOT]);
    assert.equal(r.code, 2, `"${bad}" should have been refused:\n${r.out}`);
    assert.ok(!fs.existsSync(path.join(base, 'x')), 'nothing may be written on refusal');
  }
  const busy = path.join(base, 'busy');
  fs.mkdirSync(busy);
  fs.writeFileSync(path.join(busy, 'README.md'), 'mine');
  const r = run([CREATE, busy, '--class', 'zcl_ok', '--from', ROOT]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /not empty/);
  assert.equal(run([CREATE, '--class', 'zcl_ok']).code, 2, 'no directory is a usage error');
  assert.equal(targetProblem(busy) !== null, true);
  assert.equal(targetProblem(path.join(base, 'not-yet')), null);
});

test('create: the command line', () => {
  assert.deepEqual(parseArgs(['my-app', '--class', 'zcl_x', '--package', 'X', '--repo', 'r', '--from', '.']),
    { dir: 'my-app', class: 'zcl_x', package: 'X', repo: 'r', from: '.', help: false });
  assert.throws(() => parseArgs(['--bogus', 'x']), /unknown option/);
  assert.throws(() => parseArgs(['a', 'b']), /unexpected argument/);
  assert.throws(() => parseArgs(['a', '--class']), /needs a value/);
});

test('create: the package is self-contained and ships what index.mjs imports', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'create/package.json'), 'utf8'));
  assert.equal(pkg.name, 'create-abap2ui5-app');
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.bin, { 'create-abap2ui5-app': 'index.mjs' });
  assert.equal(pkg.dependencies, undefined, 'no dependencies - fetch, fs and path are all it needs');
  assert.ok(pkg.files.includes('index.mjs') && pkg.files.includes('substitute.mjs'));
  const src = fs.readFileSync(CREATE, 'utf8');
  for (const [, dep] of src.matchAll(/from '(\.[^']+)'/g)) {
    assert.ok(pkg.files.includes(dep.replace(/^\.\//, '')), `index.mjs imports ${dep}, which package.json's files does not ship`);
  }
  // the copy is the library, byte for byte - what sync-create --check enforces
  assert.ok(fs.readFileSync(path.join(ROOT, 'create/substitute.mjs')).equals(fs.readFileSync(path.join(ROOT, 'scripts/lib/substitute.mjs'))),
    'create/substitute.mjs differs from scripts/lib/substitute.mjs - run node scripts/sync-create.mjs');
  assert.equal(run([path.join(ROOT, 'scripts/sync-create.mjs'), '--check']).code, 0);
});
