/*
 * Unit tests for scripts/add-addon.mjs and scripts/sync-addons.mjs - the
 * decisions as pure functions, and the claims the two make about this
 * repository's own files: the snapshot holds what add-addon needs, the text
 * insertion finds `dependencies` in the two real abaplint configs and leaves
 * every other byte alone, and what it writes is still a config abaplint can
 * read.
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
import {
  loadCatalog, findAddon, resolveAddons, choosePin, blankComments, findDependencies,
  registerAddons, frameworkPin, familyOf, abapCode, missingAddons, stalePins, CONFIG, CONFIG_702,
} from '../add-addon.mjs';
import { parseCatalog, selectAddons, parseRefs, catalogueFacts } from '../sync-addons.mjs';
import { parseJsonc, checkAddons } from '../doctor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CATALOG = loadCatalog();
const names = (list) => list.map((a) => a.repo);

/* A catalogue of the test's own, so the decisions are not hostage to which
 * addon cut a tag this week. */
const mk = (repo, extra = {}) => ({
  repo, org: 'abap2UI5-addons', tagline: '', useWhen: null, entryPoints: [], dependsOn: [], branch: 'main', branch702: false, tags: [], ...extra,
});
const FAKE = [
  mk('base', { tags: ['1.150.0', '1.150.0-702', '1.151.0', '1.151.0-702'], branch702: true, entryPoints: ['z2ui5_cl_base_a', 'z2ui5_if_base_b'] }),
  mk('mid', { dependsOn: ['abap2UI5-addons/base'], branch702: true, entryPoints: ['z2ui5_cl_mid_x'] }),
  mk('top', { dependsOn: ['abap2UI5-addons/base', 'abap2UI5-addons/mid', 'other/ext'], branch: 'standard' }),
  mk('ext', { org: 'other' }),
];

test('addons: the snapshot holds every fact add-addon reads, for every addon and every dependency', () => {
  assert.ok(CATALOG.length > 10, 'the snapshot lost most of its addons');
  for (const a of CATALOG) {
    for (const key of ['repo', 'org', 'branch']) assert.equal(typeof a[key], 'string', `${a.repo}: ${key}`);
    assert.ok(a.branch, `${a.repo}: no default branch - abaplint would clone whatever HEAD is`);
    assert.equal(typeof a.branch702, 'boolean');
    for (const key of ['entryPoints', 'dependsOn', 'tags']) assert.ok(Array.isArray(a[key]), `${a.repo}: ${key}`);
    for (const tag of a.tags) assert.match(tag, /^\d+\.\d+\.\d+(-702)?$/);
    for (const dep of a.dependsOn) assert.ok(findAddon(CATALOG, dep), `${a.repo} depends on ${dep}, which the snapshot does not have`);
    for (const cls of a.entryPoints) assert.match(cls, /^z2ui5_(cl|cx|if)_[a-z0-9_]+$/);
  }
  // the case the guide names, and the one default branch that is not `main`
  assert.deepEqual(names(resolveAddons(CATALOG, ['popups'])), ['layout-management', 'popups']);
  assert.ok(findAddon(CATALOG, 'popups').entryPoints.includes('z2ui5_cl_popup_to_confirm'));
  assert.equal(findAddon(CATALOG, 'http-connector').branch, 'standard');
  // not ABAP an app calls
  for (const tool of ['linter', 'mcp-server', 'vscode-extension', 'app-template']) assert.equal(findAddon(CATALOG, tool), null);
});

test('addons: a name is a repo, org/repo or its address - and an unknown one names the near ones', () => {
  assert.equal(findAddon(FAKE, 'base').repo, 'base');
  assert.equal(findAddon(FAKE, 'ABAP2UI5-addons/Base').repo, 'base');
  assert.equal(findAddon(FAKE, 'https://github.com/other/ext.git').repo, 'ext');
  assert.equal(findAddon(FAKE, 'nope'), null);
  assert.throws(() => resolveAddons(FAKE, ['bas']), /did you mean base/);
  assert.throws(() => resolveAddons(FAKE, ['zzz']), /--list/);
});

test('addons: dependencies come first, each once, whatever order they were asked in', () => {
  assert.deepEqual(names(resolveAddons(FAKE, ['top'])), ['base', 'mid', 'ext', 'top']);
  assert.deepEqual(names(resolveAddons(FAKE, ['top', 'mid', 'base'])), ['base', 'mid', 'ext', 'top']);
  assert.deepEqual(names(resolveAddons(FAKE, ['mid'])), ['base', 'mid']);
  const loop = [mk('a', { dependsOn: ['abap2UI5-addons/b'] }), mk('b', { dependsOn: ['abap2UI5-addons/a'] })];
  assert.throws(() => resolveAddons(loop, ['a']), /circle/);
  assert.throws(() => resolveAddons([mk('a', { dependsOn: ['x/gone'] })], ['a']), /incomplete/);
});

test('addons: the pin - the release tag when the addon has the framework\'s, its default branch otherwise', () => {
  const [base, mid, top] = FAKE;
  assert.deepEqual(choosePin(base, '1.151.0'), { branch: '1.151.0', pinned: true });
  // an older tag is not a pin for this release
  assert.deepEqual(choosePin(base, '1.152.0'), { branch: 'main', pinned: false });
  assert.deepEqual(choosePin(mid, '1.151.0'), { branch: 'main', pinned: false });
  assert.deepEqual(choosePin(top, '1.151.0'), { branch: 'standard', pinned: false });
  assert.deepEqual(choosePin(base, null), { branch: 'main', pinned: false });
  // 7.02: the -702 tag, else the 702 branch, else nothing at all
  assert.deepEqual(choosePin(base, '1.151.0', { downport: true }), { branch: '1.151.0-702', pinned: true });
  assert.deepEqual(choosePin(mid, '1.151.0', { downport: true }), { branch: '702', pinned: false });
  assert.equal(choosePin(top, '1.151.0', { downport: true }), null);
});

test('addons: comments are blanked in place, strings are not', () => {
  const text = '{ // "url": "x"\n "a": "http://y // z", /* "b": [ */ "c": 1 }';
  const code = blankComments(text);
  assert.equal(code.length, text.length);
  assert.ok(!code.includes('"url"'));
  assert.ok(code.includes('"http://y // z"'));
  assert.ok(!code.includes('"b"'));
  assert.equal(code.indexOf('"c"'), text.indexOf('"c"'));
});

test('addons: the two real configs - dependencies are found, the framework and its pin read', () => {
  for (const file of [CONFIG, CONFIG_702]) {
    const text = read(file);
    const deps = findDependencies(text);
    assert.equal(text[deps.close], ']');
    assert.ok(deps.entries.length >= 1, `${file}: no dependency entry found - add-addon would not know where to insert`);
    assert.match(deps.entries[0].url, /abap2UI5\/abap2UI5$/);
    assert.match(frameworkPin(text), /^\d+\.\d+\.\d+$/);
    assert.equal(text.slice(deps.entries[0].branchAt, deps.entries[0].branchAt + deps.entries[0].branch.length), deps.entries[0].branch);
  }
  assert.equal(frameworkPin(read(CONFIG)), frameworkPin(read(CONFIG_702)));
  assert.throws(() => findDependencies('{ "global": {} }'), /no "dependencies"/);
  assert.equal(frameworkPin('{ "dependencies": [ { "url": "https://github.com/abap2UI5/abap2UI5", "files": "/src" } ] }'), null);
});

test('addons: registering inserts entries and changes no other byte; a second run changes nothing', () => {
  const before = read(CONFIG);
  const framework = frameworkPin(before);
  const base = { ...FAKE[0], tags: [framework, `${framework}-702`] };
  const { text, report } = registerAddons(before, [base, FAKE[1]], framework);
  assert.deepEqual(report.map((r) => [r.addon.repo, r.what, r.branch, r.pinned]), [['base', 'added', framework, true], ['mid', 'added', 'main', false]]);

  // every original line is still there, in order - nothing reformatted, no comment lost
  const added = text.split('\n').filter((l) => !before.split('\n').includes(l));
  let rest = text;
  for (const line of before.split('\n')) {
    const at = rest.indexOf(line);
    assert.notEqual(at, -1, `line lost or reordered: ${line}`);
    rest = rest.slice(at + line.length);
  }
  assert.ok(added.some((l) => l.includes('"url": "https://github.com/abap2UI5-addons/base"')));
  assert.ok(added.some((l) => /NOT pinned/.test(l)), 'an unpinned entry has to say so in the file');

  // still a config abaplint can read, the framework first, the addons after it in order
  const cfg = parseJsonc(text);
  assert.deepEqual(cfg.dependencies.map((d) => d.url.split('/').pop()), ['abap2UI5', 'base', 'mid']);
  assert.deepEqual(cfg.dependencies[1], { url: 'https://github.com/abap2UI5-addons/base', branch: framework, folder: '/base', files: '/src/**/*.*' });
  assert.equal(cfg.dependencies[2].branch, 'main');
  assert.equal(frameworkPin(text), framework, 'the framework pin has to stay the first one a reader finds');
  assert.deepEqual(parseJsonc(before).rules, cfg.rules);

  const again = registerAddons(text, [base, FAKE[1]], framework);
  assert.equal(again.text, text);
  assert.deepEqual(again.report.map((r) => r.what), ['present', 'present']);
});

test('addons: the 7.02 config gets the -702 tag, the 702 branch, or nothing - and says which', () => {
  const before = read(CONFIG_702);
  const framework = frameworkPin(before);
  const base = { ...FAKE[0], tags: [framework, `${framework}-702`] };
  const { text, report } = registerAddons(before, [base, FAKE[1], FAKE[3]], framework, { downport: true });
  assert.deepEqual(report.map((r) => [r.addon.repo, r.what, r.branch]), [['base', 'added', `${framework}-702`], ['mid', 'added', '702'], ['ext', 'absent', null]]);
  assert.deepEqual(parseJsonc(text).dependencies.map((d) => d.branch), [`${framework}-702`, `${framework}-702`, '702']);
});

test('addons: a release-tag pin follows the framework pin; a branch somebody chose is left alone', () => {
  const cfg = (core, addon) => `{\n  "dependencies": [\n    {\n      "url": "https://github.com/abap2UI5/abap2UI5",\n      "branch": "${core}"\n    },\n    {\n      // "branch": "9.9.9" in a comment is not the pin\n      "url": "https://github.com/abap2UI5-addons/base.git",\n      "branch": "${addon}"\n    },\n  ]\n}\n`;
  const moved = registerAddons(cfg('1.151.0', '1.150.0'), [FAKE[0]], '1.151.0');
  assert.equal(moved.text, cfg('1.151.0', '1.151.0'));
  assert.deepEqual(moved.report.map((r) => [r.what, r.was, r.branch]), [['repinned', '1.150.0', '1.151.0']]);
  const kept = registerAddons(cfg('1.151.0', 'my-fork'), [FAKE[0]], '1.151.0');
  assert.equal(kept.text, cfg('1.151.0', 'my-fork'));
  // a trailing comma after the last entry stays one
  const more = registerAddons(cfg('1.151.0', '1.151.0'), [FAKE[1]], '1.151.0');
  assert.equal(parseJsonc(more.text).dependencies.length, 3);
  // an empty array is filled
  assert.equal(parseJsonc(registerAddons('{ "dependencies": [] }', [FAKE[0]], null).text).dependencies[0].branch, 'main');

  assert.deepEqual(stalePins(cfg('1.151.0', '1.150.0'), FAKE).map((s) => [s.addon.repo, s.branch, s.available]), [['base', '1.150.0', true]]);
  assert.deepEqual(stalePins(cfg('1.152.0', '1.151.0'), FAKE).map((s) => s.available), [false]);
  assert.deepEqual(stalePins(cfg('1.151.0', 'main'), FAKE), []);
});

test('addons: the hint - an addon class in code is found, in a comment or a literal it is not', () => {
  assert.equal(familyOf(FAKE[0]), 'base');
  assert.equal(familyOf(findAddon(CATALOG, 'popups')), 'popup');
  assert.equal(familyOf(mk('x', { entryPoints: ['z2ui5_cl_a_b', 'z2ui5_cl_c_d'] })), null);
  assert.equal(abapCode('* z2ui5_cl_base_a\nDATA x. " z2ui5_cl_base_a\nx = `z2ui5_cl_base_a` && |a "{ y }"| && z.').trim(), 'DATA x. \nx =  &&  && z.');

  const config = '{ "dependencies": [ { "url": "https://github.com/abap2UI5/abap2UI5" } ] }';
  const src = (text) => [{ file: 'src/zcl_a.clas.abap', text }];
  const exact = missingAddons(src('client->nav_app_call( Z2UI5_CL_BASE_A=>factory( ) ).'), config, FAKE);
  assert.deepEqual(exact.map((m) => [m.addon.repo, m.names, m.exact]), [['base', ['z2ui5_cl_base_a'], true]]);
  // not an entry point, but named like the addon's classes
  const family = missingAddons(src('DATA o TYPE REF TO z2ui5_cl_base_sample_01. DATA e TYPE REF TO z2ui5_cx_base.'), config, FAKE);
  assert.deepEqual(family.map((m) => [m.addon.repo, m.names, m.exact]), [['base', ['z2ui5_cl_base_sample_01', 'z2ui5_cx_base'], false]]);
  // the framework's own classes, a comment, a literal, a class the project defines, a registered addon
  assert.deepEqual(missingAddons(src('z2ui5_cl_ui5_view_builder=>factory( ). " z2ui5_cl_base_a\n* z2ui5_cl_base_a\nx = `z2ui5_cl_base_a`.'), config, FAKE), []);
  assert.deepEqual(missingAddons(src('z2ui5_cl_base_a=>f( ).'), config, FAKE, new Set(['z2ui5_cl_base_a'])), []);
  const registered = registerAddons(config, [FAKE[0]], null).text;
  assert.deepEqual(missingAddons(src('z2ui5_cl_base_a=>f( ).'), registered, FAKE), []);
  // the starter class names no addon
  assert.deepEqual(missingAddons([{ file: 'src/zcl_app_001.clas.abap', text: read('src/zcl_app_001.clas.abap') }], read(CONFIG), CATALOG), []);

  const results = checkAddons(exact, [{ addon: FAKE[0], branch: '1.150.0', framework: '1.151.0', available: true }]);
  assert.deepEqual(results.map((r) => r.status), ['FAIL', 'WARN']);
  assert.match(results[0].remedy, /npm run add-addon -- base/);
  assert.match(results[1].remedy, /npm run add-addon -- base/);
  assert.deepEqual(checkAddons([], []).map((r) => r.status), ['OK']);
});

test('addons: the command - --dry writes nothing, a run registers in both configs, a second run says so', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abap2ui5-addon-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of ['scripts/add-addon.mjs', 'scripts/addons.json', CONFIG, CONFIG_702]) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  const run = (...args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(dir, 'scripts/add-addon.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
  };
  const at = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  const dry = run('popups', '--dry');
  assert.equal(dry.code, 0);
  assert.match(dry.out, /nothing was written/);
  assert.equal(at(CONFIG), read(CONFIG));

  const first = run('popups');
  assert.equal(first.code, 0, first.out);
  assert.deepEqual(parseJsonc(at(CONFIG)).dependencies.map((d) => d.url.split('/').pop()), ['abap2UI5', 'layout-management', 'popups']);
  assert.deepEqual(parseJsonc(at(CONFIG_702)).dependencies.map((d) => d.url.split('/').pop()), ['abap2UI5', 'layout-management', 'popups']);
  // what the system needs: the order, and that an addon is its own install
  const order = first.out.slice(first.out.indexOf('On the system'));
  assert.ok(order.indexOf('abap2UI5/abap2UI5') < order.indexOf('layout-management') && order.indexOf('layout-management') < order.indexOf('addons/popups'));
  assert.match(order, /NOT part of abap2UI5/);

  const after = at(CONFIG);
  const second = run('popups');
  assert.match(second.out, /Nothing to change/);
  assert.equal(at(CONFIG), after);

  assert.match(run('--list').out, /\* popups/);
  assert.equal(run('no-such-addon').code, 1);
  assert.equal(run().code, 2);
  assert.equal(run('popups', '--force').code, 2);
});

test('sync-addons: the catalogue is read by pattern - group, org, and which entries are addons', () => {
  const ts = `export const groups = [
  { id: "apps", title: "A", entries: [
      { repo: "one", site: "https://x/one/" },
      { repo: "two" },
  ] },
  { id: "developer-tools", title: "T", entries: [
      { repo: "tool", org: "abap2UI5" },
      { repo: "lib", org: "abap2UI5" },
  ] },
];`;
  const entries = parseCatalog(ts);
  assert.deepEqual(entries, [
    { repo: 'one', org: 'abap2UI5-addons', group: 'apps' },
    { repo: 'two', org: 'abap2UI5-addons', group: 'apps' },
    { repo: 'tool', org: 'abap2UI5', group: 'developer-tools' },
    { repo: 'lib', org: 'abap2UI5', group: 'developer-tools' },
  ]);
  const records = entries.map((e) => ({ ...e, tagline: `${e.repo}!`, entryPoints: [], dependsOn: e.repo === 'one' ? ['abap2UI5/lib', 'else/where'] : null }));
  // the tools stay out, a dependency comes in whether the catalogue describes it or not
  assert.deepEqual(selectAddons(records).map((a) => `${a.org}/${a.repo}`), ['abap2UI5-addons/one', 'abap2UI5-addons/two', 'abap2UI5/lib', 'else/where']);
  assert.deepEqual(catalogueFacts(records[1]), { repo: 'two', org: 'abap2UI5-addons', tagline: 'two!', useWhen: null, entryPoints: [], dependsOn: [] });
});

test('sync-addons: refs - the default branch, a 702 branch, release tags only and in order', () => {
  const refs = parseRefs([
    'ref: refs/heads/standard\tHEAD',
    'aaa\tHEAD',
    'aaa\trefs/heads/standard',
    'bbb\trefs/heads/702',
    'ccc\trefs/tags/1.151.0-702',
    'ccc\trefs/tags/1.151.0',
    'ccc\trefs/tags/1.9.0',
    'ccc\trefs/tags/v2.0.0',
    'ccc\trefs/tags/ci-v1.0.0^{}',
  ].join('\n'));
  assert.deepEqual(refs, { branch: 'standard', branch702: true, tags: ['1.9.0', '1.151.0', '1.151.0-702'] });
  assert.deepEqual(parseRefs('aaa\trefs/heads/main\n'), { branch: null, branch702: false, tags: [] });
});

test('sync-addons: the snapshot matches the catalogue, or the catalogue is unreachable', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/sync-addons.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /OK|SKIPPED/);
});

test('addons: package.json runs the script, and both files reach a project and an agent setup', () => {
  const spec = JSON.parse(read('template.json'));
  assert.equal(JSON.parse(read('package.json')).scripts['add-addon'], 'node scripts/add-addon.mjs');
  for (const f of ['scripts/add-addon.mjs', 'scripts/addons.json']) {
    assert.ok(spec.files.shared.includes(f), `${f} is not shared - a project would get the npm script without it`);
    assert.ok(spec.agentSetup.files[f], `${f} is not in agentSetup.files`);
  }
  assert.ok(spec.files.templateOwn['scripts/sync-addons.mjs']);
});
