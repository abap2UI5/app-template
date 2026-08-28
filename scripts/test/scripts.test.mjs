/*
 * Unit tests for scripts/.
 *
 * All four programs find things by regex in files somebody else edits, and a
 * pattern that stops matching does not fail - it makes its gate pass by
 * checking nothing. check-pin.mjs says so about itself ("the file changed shape
 * - fix the pattern ... or this gate silently stops checking that place") and
 * until now nothing verified that the patterns still match.
 *
 * So the tests that matter here are not "does the function work" but "does the
 * claim this repository makes about its own files still hold".
 *
 *   node --test scripts/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const SPEC = json('template.json');
const PKG = json('package.json');

const run = (script, args = []) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

/* ---------------------------------------------------------------- check-pin */

test('check-pin: every non-optional site pattern still matches its file', () => {
  // The patterns are declared in check-pin.mjs; re-deriving them here would
  // test a copy. Read them out of the source instead, so an edited pattern is
  // an edited test subject.
  const src = read('scripts/check-pin.mjs');
  const block = src.slice(src.indexOf('const SITES = ['), src.indexOf('];', src.indexOf('const SITES = [')));
  const sites = [...block.matchAll(/file:\s*'([^']+)',\s*what:\s*'[^']*',\s*re:\s*(\/.*?\/),(\s*optional:\s*true,)?/gs)]
    .map(([, file, re, optional]) => ({ file, re, optional: Boolean(optional) }));

  assert.equal(sites.length, 3, 'expected three declared sites');
  for (const site of sites) {
    if (site.optional && !fs.existsSync(path.join(ROOT, site.file))) continue;
    const [body, flags] = [site.re.slice(1, site.re.lastIndexOf('/')), site.re.slice(site.re.lastIndexOf('/') + 1)];
    const m = new RegExp(body, flags).exec(read(site.file));
    assert.ok(m, `check-pin's pattern for ${site.file} no longer matches - the gate would stop checking it`);
    assert.match(m[1], /^\d+\.\d+\.\d+$/);
  }
});

test('check-pin: the three places name one release, and the gate passes', () => {
  const versions = new Set([
    /"branch":\s*"(\d+\.\d+\.\d+)"/.exec(read('abaplint.jsonc'))[1],
    /needs framework \*\*(\d+\.\d+\.\d+) or newer\*\*/.exec(read('README.md'))[1],
    /pinned to release tag `(\d+\.\d+\.\d+)`/.exec(read('AGENTS.md'))[1],
  ]);
  assert.equal(versions.size, 1, `the framework release is written differently in different places: ${[...versions]}`);
  assert.equal(run('check-pin.mjs').code, 0);
});

test('check-pin: a missing optional site is forgiven, a missing required one is not', () => {
  // A project made from this template writes its own README, so check-pin has
  // to survive its absence - that is what makes the script shippable at all.
  const src = read('scripts/check-pin.mjs');
  const optionalFor = (file) => new RegExp(`file: '${file}'[\\s\\S]{0,200}?optional: true`).test(src);
  assert.ok(optionalFor('README.md'), 'README.md must be optional - a project writes its own');
  assert.ok(!optionalFor('abaplint.jsonc'), 'abaplint.jsonc ships, so its absence is a real defect');
  assert.ok(!optionalFor('AGENTS.md'), 'AGENTS.md ships, so its absence is a real defect');
  assert.match(src, /if \(!found\.length\)/, 'with every site optional the gate must not pass by checking nothing');
});

/* ----------------------------------------------------------- check-template */

test('check-template: passes on this repository', () => {
  const { code, out } = run('check-template.mjs');
  assert.equal(code, 0, out);
});

test('check-template: the shared set is closed under what it invokes', () => {
  const shared = new Set(SPEC.files.shared);
  for (const [name, body] of Object.entries(PKG.scripts)) {
    for (const [, target] of body.matchAll(/node\s+(scripts\/[\w./-]+)/g)) {
      assert.ok(shared.has(target), `package.json ships and its "${name}" runs ${target}, which is not shared`);
    }
  }
  for (const file of SPEC.files.shared.filter((f) => f.endsWith('.yml'))) {
    const text = read(file);
    for (const [, npmScript] of text.matchAll(/run:\s*npm run ([\w:]+)/g)) {
      assert.ok(PKG.scripts[npmScript], `${file} ships and runs "npm run ${npmScript}", undefined in the shared package.json`);
    }
    if (/run:\s*npm ci\b/.test(text)) {
      assert.ok(shared.has('package-lock.json'), `${file} ships and runs "npm ci", which needs the lockfile shipped too`);
    }
  }
});

test('check-template: the blessed class rule is one abaplint accepts', () => {
  const clas = /"clas":\s*"([^"]+)"/.exec(read('abaplint.jsonc'))[1];
  const blessed = new RegExp(SPEC.substitutions.class.rule);
  const linted = new RegExp(clas, 'i');
  for (const probe of ['zcl_app_001', 'zcx_app_001', 'ycl_app_001', 'ycx_app_001']) {
    if (blessed.test(probe)) assert.ok(linted.test(probe), `rename would accept "${probe}" and npm run check would then reject it`);
  }
  assert.ok(blessed.test('zcl_my_app'), 'the canonical name has to stay valid');
});

test('check-template: every substitution target is a file somebody receives', () => {
  const handed = new Set([...SPEC.files.shared, ...SPEC.files.named]);
  for (const file of SPEC.substitutions.class.files) {
    assert.ok(handed.has(file), `substitutions.class names ${file}, which is not handed out`);
  }
});

test('check-template: scripts/ is walked, not exempted', () => {
  const src = read('scripts/check-template.mjs');
  assert.ok(!/rel\.startsWith\('scripts\/'\)/.test(src),
    'the blanket scripts/ exemption is how a shared package.json could name an unshipped script');
});

/* ---------------------------------------------------------- generate-agents */

test('generate-agents: the mirrored half is in sync, or the guide is unreachable', () => {
  const { code, out } = run('generate-agents.mjs', ['--check']);
  // The generator is documented to pass and say so when it cannot reach the
  // guide; a real drift is a failure.
  if (code !== 0) assert.match(out, /could not|unreachable|network/i, out);
});

test('generate-agents: AGENTS.md still carries the heading the split is made at', () => {
  assert.match(read('AGENTS.md'), /^## 1\. The model in one paragraph$/m,
    'the generator splits the file at this heading - without it the mirror has no boundary');
});

/* ------------------------------------------------------------------ rename */

test('rename: --dry renames class, sidecar and package text without writing', () => {
  const before = read('src/zcl_app_001.clas.abap');
  const { code, out } = run('rename.mjs', ['--class', 'zcl_probe_app', '--package', 'Probe', '--dry']);
  assert.equal(code, 0, out);
  assert.match(out, /zcl_probe_app/);
  assert.equal(read('src/zcl_app_001.clas.abap'), before, '--dry must not write');
  assert.ok(fs.existsSync(path.join(ROOT, 'src/zcl_app_001.clas.abap')), '--dry must not move files');
});

test('rename: rejects a name its own lint would reject', () => {
  for (const bad of ['ycl_my_app', 'my_app', 'zcl_' + 'x'.repeat(40)]) {
    const { code } = run('rename.mjs', ['--class', bad, '--dry']);
    assert.equal(code, 2, `"${bad}" should have been refused`);
  }
});

test('rename: the placeholder it renames is the class actually in the repository', () => {
  const cls = SPEC.placeholderClass;
  for (const ext of ['clas.abap', 'clas.xml']) {
    assert.ok(fs.existsSync(path.join(ROOT, `src/${cls}.${ext}`)), `src/${cls}.${ext} is missing`);
  }
});
