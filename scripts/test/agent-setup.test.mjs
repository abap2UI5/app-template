/*
 * `npm create abap2ui5-app -- --agent-setup` writes into somebody's existing
 * repository, so what it must NOT do matters as much as what it does: never
 * overwrite a file, never touch src/, only ever add to package.json and
 * .gitignore, and change nothing on a second run. Each test below builds the
 * kind of project it is about in a temp directory, runs the real command
 * against this checkout (--from), and looks at the result.
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
import { parseArgs } from '../../create/index.mjs';
import { adaptSourceFolder, mergeLines, mergePackageJson, packageNameFor, startingFolder } from '../../create/agent-setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'template.json'), 'utf8'));
const SETUP = SPEC.agentSetup;
const CREATE = path.join(ROOT, 'create/index.mjs');
const TEMPLATE_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const run = (args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};
const setup = (dir, ...extra) => run([CREATE, '--agent-setup', dir, '--from', ROOT, ...extra]);

/** Every file under `dir` with its bytes, relative paths sorted. */
const snapshot = (dir) => {
  const out = new Map();
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else out.set(rel, fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, '');
  return out;
};

const write = (dir, rel, content) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-agent-setup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** An abapGit project that never saw the template: one class in `folder`,
 *  the .abapgit.xml that says where it is, a README. */
const abapgitProject = (dir, folder = 'src') => {
  write(dir, '.abapgit.xml', `﻿<?xml version="1.0" encoding="utf-8"?>\n<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n <asx:values>\n  <DATA>\n   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>\n   <STARTING_FOLDER>/${folder}/</STARTING_FOLDER>\n   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>\n  </DATA>\n </asx:values>\n</asx:abap>\n`);
  write(dir, `${folder}/zcl_mine.clas.abap`, 'CLASS zcl_mine DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_mine IMPLEMENTATION.\nENDCLASS.\n');
  write(dir, `${folder}/zcl_mine.clas.xml`, '﻿<?xml version="1.0" encoding="utf-8"?>\n');
  write(dir, 'README.md', '# my app\n');
};

test('agent-setup: a fresh empty directory gets every file agentSetup names, and nothing else', (t) => {
  const dir = path.join(tmp(t), 'my-App');
  fs.mkdirSync(dir);
  const r = setup(dir);
  assert.equal(r.code, 0, r.out);

  const got = [...snapshot(dir).keys()].sort();
  assert.deepEqual(got, Object.keys(SETUP.files).sort(), 'the written set is not agentSetup.files');
  for (const rel of got) {
    if (SETUP.merge[rel]) continue;
    assert.ok(fs.readFileSync(path.join(dir, rel)).equals(fs.readFileSync(path.join(ROOT, rel))),
      `${rel} differs from the template's - in src/ nothing needs adapting`);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'src')), 'src/ is the project\'s - agent setup never creates it');
  assert.ok(!fs.existsSync(path.join(dir, 'package-lock.json')), 'the template\'s lockfile does not lock a merged package.json');

  // package.json: written from the merge, under the directory's name, not the template's file
  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.equal(pkg.name, 'my-app');
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, undefined, 'the template\'s license is not this project\'s to declare');
  for (const key of SETUP.merge['package.json'].keys) assert.deepEqual(pkg[key], TEMPLATE_PKG[key], `${key} is not the template's`);

  // closed: every `npm run` check.yml runs, and every `node scripts/...` those run, is here
  const yml = read(dir, '.github/workflows/check.yml');
  for (const [, name] of yml.matchAll(/run:\s*npm run ([\w:]+)/g)) {
    assert.ok(pkg.scripts[name], `check.yml runs "npm run ${name}", which package.json does not define`);
  }
  for (const body of Object.values(pkg.scripts)) {
    for (const [, target] of body.matchAll(/node\s+(scripts\/[\w./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(dir, target)), `package.json runs ${target}, which is not here`);
    }
  }
  assert.match(r.out, /src\/ does not exist/, 'a gate pointed at nothing has to be said');
  assert.match(r.out, /\/plugin install abap2ui5@abap2ui5/);
  assert.match(r.out, /npm install/);
});

test('agent-setup: an existing project keeps its AGENTS.md, src/ and package.json values - merged, never overwritten', (t) => {
  const dir = tmp(t);
  abapgitProject(dir);
  write(dir, 'AGENTS.md', '# my own agent guide\n');
  write(dir, 'package.json', `${JSON.stringify({
    name: 'mine',
    version: '3.1.4',
    scripts: { check: 'echo my own check', build: 'echo build' },
    dependencies: { '@abap2ui5/linter': '^0.7.0' },
    devDependencies: { '@abaplint/cli': '^2.100.0' },
  }, null, 4)}\n`);
  write(dir, '.gitignore', 'dist\nnode_modules\n');
  const before = snapshot(dir);

  const r = setup(dir);
  assert.equal(r.code, 0, r.out);

  assert.equal(read(dir, 'AGENTS.md'), '# my own agent guide\n');
  assert.match(r.out, /skipped\s+AGENTS\.md\s+already there/);
  for (const [rel, bytes] of before) {
    if (rel.startsWith('src/') || rel === '.abapgit.xml' || rel === 'README.md') {
      assert.ok(fs.readFileSync(path.join(dir, rel)).equals(bytes), `${rel} was changed`);
    }
  }

  const text = read(dir, 'package.json');
  assert.match(text, /^ {4}"name"/m, 'the project\'s four-space indentation was not kept');
  const pkg = JSON.parse(text);
  assert.equal(pkg.name, 'mine');
  assert.equal(pkg.version, '3.1.4');
  assert.equal(pkg.scripts.check, 'echo my own check', 'an existing script was overwritten');
  assert.equal(pkg.scripts.build, 'echo build');
  assert.equal(pkg.scripts['check:abap'], TEMPLATE_PKG.scripts['check:abap'], 'a missing script was not added');
  assert.equal(pkg.devDependencies['@abaplint/cli'], '^2.100.0', 'an existing devDependency was overwritten');
  assert.equal(pkg.devDependencies['@abap2ui5/linter'], undefined, 'a gate the project has under dependencies was added twice');
  assert.equal(pkg.devDependencies['@abap2ui5/linter-render'], TEMPLATE_PKG.devDependencies['@abap2ui5/linter-render']);
  assert.equal(pkg.engines.node, TEMPLATE_PKG.engines.node);
  assert.match(r.out, /kept your scripts\.check "echo my own check"/);
  assert.match(r.out, /kept your devDependencies\.@abaplint\/cli/);

  const ignore = read(dir, '.gitignore');
  assert.ok(ignore.startsWith('dist\nnode_modules\n'), 'the project\'s .gitignore was reordered');
  assert.equal(ignore.match(/node_modules/g).length, 1, 'node_modules is ignored already, in another spelling');
  assert.match(ignore, /^\.playwright\/$/m);
});

test('agent-setup: another STARTING_FOLDER moves the gates there, and only the source glob', (t) => {
  const dir = tmp(t);
  abapgitProject(dir, 'abap/src');
  const r = setup(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /sources\s+abap\/src\/ \(\.abapgit\.xml STARTING_FOLDER\)/);
  assert.doesNotMatch(r.out, /does not exist/);

  const lint = read(dir, 'abaplint.jsonc');
  assert.match(lint, /"global": \{\s*"files": "\/abap\/src\/\*\*\/\*\.\*"/);
  assert.equal(lint.match(/"files": "\/src\/\*\*\/\*\.\*"/g)?.length, 1, 'the framework dependency\'s own folder has to stay /src/');
  assert.match(read(dir, 'abap2ui5lint.jsonc'), /"paths": \["abap\/src"\]/);
  assert.match(read(dir, '.github/workflows/check.yml'), /^\s+paths: abap\/src$/m);
  assert.match(JSON.parse(read(dir, 'package.json')).scripts['test:unit'], /abap2ui5-unit abap\/src$/);
  assert.ok(!fs.existsSync(path.join(dir, 'src')));

  // every edit template.json declares was applied - none silently missed its text
  for (const edit of SETUP.sourceFolder.edits) {
    assert.ok(read(dir, edit.file).includes(edit.text.replace('src', 'abap/src')), `${edit.file}: ${edit.text} was not adapted`);
  }
});

test('agent-setup: a second run changes nothing and says so', (t) => {
  const dir = tmp(t);
  abapgitProject(dir);
  write(dir, 'package.json', '{\n  "name": "mine",\n  "scripts": { "test": "echo mine" }\n}\n');
  assert.equal(setup(dir).code, 0);
  const first = snapshot(dir);

  const r = setup(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 written, \d+ skipped - the agent setup was already complete/);
  assert.doesNotMatch(r.out, /^\s+(added|merged)\s/m);
  const second = snapshot(dir);
  assert.deepEqual([...second.keys()], [...first.keys()]);
  for (const [rel, bytes] of first) assert.ok(second.get(rel).equals(bytes), `${rel} changed on the second run`);
});

test('agent-setup: refuses what it cannot do, and writes nothing then', (t) => {
  const base = tmp(t);
  const r1 = run([CREATE, '--agent-setup', path.join(base, 'not-there'), '--from', ROOT]);
  assert.equal(r1.code, 2, r1.out);
  assert.match(r1.out, /does not exist/);
  assert.ok(!fs.existsSync(path.join(base, 'not-there')));

  const r2 = run([CREATE, '--agent-setup', base, '--class', 'zcl_x', '--from', ROOT]);
  assert.equal(r2.code, 2, r2.out);
  assert.match(r2.out, /--class has no meaning with --agent-setup/);

  write(base, 'package.json', '{ "name": "broken", }');
  const r3 = setup(base);
  assert.equal(r3.code, 1, r3.out);
  assert.match(r3.out, /package\.json is not valid JSON.*nothing was written/s);
  assert.deepEqual([...snapshot(base).keys()], ['package.json'], 'a refused run wrote files');
});

test('agent-setup: an abaplint.jsonc of the project\'s own that pins no release is said, for whichever check:pin runs', (t) => {
  const unpinned = '{ "global": { "files": "/src/**/*.*" }, "dependencies": [{ "url": "https://github.com/abap2UI5/abap2UI5", "branch": "main" }] }\n';
  const a = tmp(t);
  abapgitProject(a);
  write(a, 'abaplint.jsonc', unpinned);
  const ra = setup(a);
  assert.equal(ra.code, 0, ra.out);
  assert.match(ra.out, /`npm run check:pin` \(the first step of check\.yml\) and `npm run doctor` would fail/);
  assert.match(ra.out, /abaplint\.jsonc: no release number found/);
  assert.equal(read(a, 'abaplint.jsonc'), unpinned, 'the project\'s abaplint.jsonc was changed');

  const b = tmp(t);
  abapgitProject(b);
  write(b, 'abaplint.jsonc', unpinned);
  write(b, 'package.json', '{ "name": "b", "scripts": { "check:pin": "node my-own-pin-check.mjs" } }\n');
  const rb = setup(b);
  assert.equal(rb.code, 0, rb.out);
  assert.match(rb.out, /`npm run doctor` would report the framework pin as FAIL \(your own check:pin script is not affected\)/);

  const c = tmp(t);
  abapgitProject(c);
  assert.doesNotMatch(setup(c).out, /framework pin|check:pin/, 'the template\'s own abaplint.jsonc pins a release - nothing to say');
});

test('agent-setup: the command line, and the pure pieces', () => {
  assert.deepEqual(parseArgs(['--agent-setup']),
    { dir: undefined, class: undefined, package: undefined, repo: undefined, from: undefined, agentSetup: true, help: false });
  assert.equal(parseArgs(['--agent-setup', '../proj', '--from', 'x']).dir, '../proj');
  assert.equal(parseArgs(['../proj', '--agent-setup']).agentSetup, true);
  assert.throws(() => parseArgs(['--agentSetup', 'x']), /unknown option/);

  assert.equal(startingFolder('<STARTING_FOLDER>/src/</STARTING_FOLDER>'), 'src');
  assert.equal(startingFolder('<STARTING_FOLDER>/abap/src/</STARTING_FOLDER>'), 'abap/src');
  assert.equal(startingFolder('<STARTING_FOLDER>/</STARTING_FOLDER>'), '');
  assert.equal(startingFolder('<DATA></DATA>'), null);

  const sf = SETUP.sourceFolder;
  const lint = fs.readFileSync(path.join(ROOT, 'abaplint.jsonc'), 'utf8');
  assert.equal(adaptSourceFolder('abaplint.jsonc', lint, sf, 'src'), lint, 'the template\'s own folder changes nothing');
  assert.equal(adaptSourceFolder('README.md', 'src/ src/', sf, 'abap'), 'src/ src/', 'a file no edit names changes nothing');

  const merged = mergePackageJson('{"scripts":{"check":"mine"}}', JSON.stringify(TEMPLATE_PKG), ['scripts']);
  assert.equal(JSON.parse(merged.text).scripts.check, 'mine');
  assert.ok(merged.added.includes('scripts.check:abap'));
  assert.deepEqual(merged.kept.map((k) => k.entry), ['scripts.check']);
  assert.equal(mergePackageJson(JSON.stringify(TEMPLATE_PKG), JSON.stringify(TEMPLATE_PKG), ['scripts']).text, null, 'nothing to add is no write');
  assert.throws(() => mergePackageJson('{ nope', '{}', ['scripts']));

  assert.equal(mergeLines('/node_modules\n.playwright\n', 'node_modules/\n.playwright/\n').text, null);
  assert.equal(mergeLines('', '# why\nnode_modules/\n').text, '# why\nnode_modules/\n');
  assert.equal(mergeLines('dist', 'a\n\n# b\nb\n').text, 'dist\n\na\n\n# b\nb\n');

  assert.equal(packageNameFor('/x/My App'), 'my-app');
  assert.equal(packageNameFor('/x/abap2UI5-samples'), 'abap2ui5-samples');
});
