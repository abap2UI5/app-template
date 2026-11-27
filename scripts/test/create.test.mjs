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
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  COMMIT_API, TIMEOUT, invokedAsCommand, materialise, parseArgs, pathProblem, rawBase, resolveCommit, sourceFor, targetProblem, writeProject,
} from '../../create/index.mjs';

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

/* A project is fetched file by file. Read from the branch, a push landing
 * half-way gave it files of two commits; so main is resolved to its SHA once
 * and every file read from there. */
test('create: main is resolved to one commit and every file is fetched from it', async () => {
  const SHA = 'a'.repeat(40);
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    assert.ok(init?.signal, `${url} is fetched without a timeout`);
    if (url === COMMIT_API) {
      assert.equal(init.headers.accept, 'application/vnd.github.sha');
      return new Response(`${SHA}\n`);
    }
    return new Response(Buffer.from(url.endsWith('template.json') ? JSON.stringify(SPEC) : 'x'));
  };
  const source = await sourceFor(undefined, { fetchImpl, warn: () => assert.fail('no warning when the SHA resolves') });
  assert.equal(source.ref, SHA);
  assert.equal(source.name, rawBase(SHA));
  const spec = JSON.parse((await source.read('template.json')).toString('utf8'));
  const files = await materialise(spec, source.read, { newClass: 'zcl_probe_app', newPackage: undefined, newRepo: 'probe' });
  assert.equal(files.length, SPEC.files.shared.length + SPEC.files.named.length);
  assert.equal(urls.filter((u) => u === COMMIT_API).length, 1, 'the SHA is resolved once');
  for (const u of urls.filter((x) => x !== COMMIT_API)) {
    assert.ok(u.startsWith(`https://raw.githubusercontent.com/abap2UI5/app-template/${SHA}/`), u);
  }
});

test('create: when the commit cannot be resolved it reads main, and says so; a request that hangs times out', async (t) => {
  for (const answer of [() => new Response('rate limited', { status: 403 }), () => new Response('<html>'), () => Promise.reject(new Error('offline'))]) {
    const warnings = [];
    const ref = await resolveCommit({ fetchImpl: async () => answer(), warn: (m) => warnings.push(m) });
    assert.equal(ref, 'main');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not resolve the template's main to a commit .* reading the branch main/);
  }
  // AbortSignal.timeout keeps no process alive - a socket would
  const alive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(alive));
  const saved = { ...TIMEOUT };
  t.after(() => Object.assign(TIMEOUT, saved));
  TIMEOUT.commit = 30;
  TIMEOUT.file = 30;
  const hang = async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const warnings = [];
  const source = await sourceFor(undefined, { fetchImpl: hang, warn: (m) => warnings.push(m) });
  assert.equal(source.ref, 'main');
  assert.match(warnings[0], /no answer from https:\/\/api\.github\.com\/.* within 0\.03 s/);
  await assert.rejects(source.read('template.json'), /no answer from https:\/\/raw\.githubusercontent\.com\/abap2UI5\/app-template\/main\/template\.json within 0\.03 s/);
});

test('create: a template.json path that leads outside the project is refused before anything is read', async () => {
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\x', '..\\x', '']) assert.ok(pathProblem(bad), `${JSON.stringify(bad)} passed`);
  for (const good of ['a', 'src/zcl_app_001.clas.abap', '.github/workflows/check.yml', 'a/../b']) assert.equal(pathProblem(good), null, good);
  const spec = { ...SPEC, files: { ...SPEC.files, shared: ['../outside.txt'], named: [] } };
  const read = async () => assert.fail('nothing is read');
  await assert.rejects(materialise(spec, read, { newClass: 'zcl_probe_app' }), /template\.json names \.\.\/outside\.txt leads outside the project/);
});

test('create: the project is written into a temporary directory and renamed - a failure leaves nothing behind', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-create-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bytes = Buffer.from('x');
  // 'a' is a file, so 'a/b' cannot be written - half-way through
  const target = path.join(base, 'broken');
  assert.throws(() => writeProject(target, [{ path: 'ok.txt', bytes }, { path: 'a', bytes }, { path: 'a/b', bytes }]));
  assert.deepEqual(fs.readdirSync(base), [], 'no project, no temporary directory');
  // an empty directory made for it stays, empty, when the write fails
  fs.mkdirSync(target);
  assert.throws(() => writeProject(target, [{ path: 'a', bytes }, { path: 'a/b', bytes }]));
  assert.deepEqual(fs.readdirSync(base), ['broken']);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.throws(() => writeProject(target, [{ path: '../escaped.txt', bytes }]), /outside the project/);
  assert.ok(!fs.existsSync(path.join(base, 'escaped.txt')));
  // and when it works, the empty directory is the project
  writeProject(target, [{ path: 'src/a.txt', bytes }, { path: 'b.txt', bytes }]);
  assert.deepEqual(tree(target), ['b.txt', 'src/a.txt']);
  assert.deepEqual(fs.readdirSync(base), ['broken']);
});

test('create: --package longer than abapGit holds is refused; the default name is the directory as npm accepts it', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-create-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const long = run([CREATE, path.join(base, 'x'), '--class', 'zcl_probe_app', '--package', 'p'.repeat(61), '--from', ROOT]);
  assert.equal(long.code, 2, long.out);
  assert.match(long.out, /--package is 61 characters long - abapGit's package description holds at most 60/);
  assert.ok(!fs.existsSync(path.join(base, 'x')));
  const dir = path.join(base, 'My Probe App');
  const made = run([CREATE, dir, '--class', 'zcl_probe_app', '--package', 'p'.repeat(60), '--from', ROOT]);
  assert.equal(made.code, 0, made.out);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name, 'my-probe-app');
  assert.match(fs.readFileSync(path.join(dir, '.abapgit.xml'), 'utf8'), /<NAME>my-probe-app<\/NAME>/);
  assert.deepEqual(fs.readdirSync(base), ['My Probe App'], 'no temporary directory left next to it');
});

/* `npm create` / `npm exec` run the package through its node_modules/.bin
 * link, so the script sees the LINK as process.argv[1]. The main-module check
 * compared that with import.meta.url as it came, never matched, and the
 * command printed nothing and exited 0 - no project, no usage, no error. */
test('create: runs when started through a bin link, as npm create starts it', { skip: process.platform === 'win32' }, (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-create-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bin = path.join(base, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  const link = path.join(bin, 'create-abap2ui5-app');
  fs.symlinkSync(CREATE, link);
  const usage = run([link]);
  assert.equal(usage.code, 2, 'no directory is a usage error - it exited 0 having done nothing');
  assert.match(usage.out, /usage: npm create abap2ui5-app/);
  const made = run([link, path.join(base, 'my app'), '--class', 'zcl_linked_app', '--from', ROOT]);
  assert.equal(made.code, 0, made.out);
  assert.ok(fs.existsSync(path.join(base, 'my app', 'src', 'zcl_linked_app.clas.abap')), made.out);
  assert.equal(invokedAsCommand(link, pathToFileURL(CREATE).href), true);
  assert.equal(invokedAsCommand(path.join(base, 'elsewhere.mjs'), pathToFileURL(CREATE).href), false);
  assert.equal(invokedAsCommand(undefined, pathToFileURL(CREATE).href), false);
});

test('create: the command line', () => {
  assert.deepEqual(parseArgs(['my-app', '--class', 'zcl_x', '--package', 'X', '--repo', 'r', '--from', '.']),
    { dir: 'my-app', class: 'zcl_x', package: 'X', repo: 'r', from: '.', agentSetup: false, help: false });
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
  // every module it ships imports only modules it ships - index.mjs and the
  // ones it pulls in (agent-setup.mjs) alike
  for (const file of pkg.files.filter((f) => f.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(ROOT, 'create', file), 'utf8');
    for (const [, dep] of src.matchAll(/from '(\.[^']+)'/g)) {
      assert.ok(pkg.files.includes(dep.replace(/^\.\//, '')), `${file} imports ${dep}, which package.json's files does not ship`);
    }
    for (const [, dep] of src.matchAll(/from '([^.'][^']*)'/g)) {
      assert.match(dep, /^node:/, `${file} imports ${dep} - the package has no dependencies, only node: built-ins`);
    }
  }
  // the copy is the library, byte for byte - what sync-create --check enforces
  assert.ok(fs.readFileSync(path.join(ROOT, 'create/substitute.mjs')).equals(fs.readFileSync(path.join(ROOT, 'scripts/lib/substitute.mjs'))),
    'create/substitute.mjs differs from scripts/lib/substitute.mjs - run node scripts/sync-create.mjs');
  assert.equal(run([path.join(ROOT, 'scripts/sync-create.mjs'), '--check']).code, 0);
});

// A package text or repo name is user input: it lands in a .xml sidecar and a
// package.json as text. Unescaped, `R&D` breaks the XML, a `"` breaks the
// JSON, and `$&` was read as a String.replace pattern and pasted the match in.
test('substitute: values are escaped for XML and JSON, and never read as a replace pattern', async () => {
  const { applyElement, applyJsonKey } = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/substitute.mjs')).href);
  assert.equal(
    applyElement('<a><CTEXT>abap2UI5 app</CTEXT></a>', 'CTEXT', `R&D <"Tom's"> $& $1`),
    '<a><CTEXT>R&amp;D &lt;&quot;Tom&apos;s&quot;&gt; $&amp; $1</CTEXT></a>');
  const json = applyJsonKey('{\n  "name": "abap2ui5-app",\n  "x": 1\n}\n', 'name', 'a"b\\c $& $`');
  assert.equal(json, '{\n  "name": "a\\"b\\\\c $& $`",\n  "x": 1\n}\n');
  assert.equal(JSON.parse(json).name, 'a"b\\c $& $`');
});
