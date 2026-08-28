/*
 * The test that would have caught it.
 *
 * A project made from this template is not this repository: it gets
 * `files.shared` plus `files.named`, and nothing else. Every gate here ran
 * against the template, where `scripts/` is present and the lockfile is
 * committed — so the one state nobody ever exercised was the only state a user
 * ever sees.
 *
 * This materialises a project the way abap2UI5/mcp-server's `scaffold_app` and
 * the VS Code extension do — from `template.json`, into a temp directory — and
 * then runs what its own CI would run. It fails if the project inherits a
 * command it cannot execute.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'template.json'), 'utf8'));
const NEW_CLASS = 'zcl_scaffold_probe';
const OLD_CLASS = SPEC.placeholderClass;

/** What the three executors agree a project receives. */
function materialise(dir) {
  const subs = new Set(SPEC.substitutions.class.files);
  for (const rel of [...SPEC.files.shared, ...SPEC.files.named]) {
    const src = path.join(ROOT, rel);
    let text = fs.readFileSync(src);
    let out = rel;
    if (subs.has(rel)) {
      text = Buffer.from(
        text.toString('utf8')
          .replaceAll(OLD_CLASS, NEW_CLASS)
          .replaceAll(OLD_CLASS.toUpperCase(), NEW_CLASS.toUpperCase()),
        'utf8',
      );
    }
    if (SPEC.substitutions.class.renamesPath) out = rel.replaceAll(OLD_CLASS, NEW_CLASS);
    fs.mkdirSync(path.join(dir, path.dirname(out)), { recursive: true });
    fs.writeFileSync(path.join(dir, out), text);
  }
}

/** The commands the handed-out workflow actually runs, in order. */
function ciCommands() {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/check.yml'), 'utf8');
  return [...yml.matchAll(/^\s+run:\s*(.+)$/gm)].map(([, cmd]) => cmd.trim());
}

test('a scaffolded project can run every command its CI runs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-scaffold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  materialise(dir);

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

  for (const cmd of ciCommands()) {
    const npmRun = /^npm run ([\w:]+)/.exec(cmd);
    if (npmRun) {
      const body = pkg.scripts[npmRun[1]];
      assert.ok(body, `CI runs "${cmd}" and the project's package.json has no such script`);
      for (const [, target] of body.matchAll(/node\s+(scripts\/[\w./-]+)/g)) {
        assert.ok(fs.existsSync(path.join(dir, target)),
          `CI runs "${cmd}" -> "${body}", and ${target} is not in the project`);
      }
      continue;
    }
    if (/^npm ci\b/.test(cmd)) {
      assert.ok(fs.existsSync(path.join(dir, 'package-lock.json')),
        'CI runs "npm ci" and the project has no package-lock.json');
      continue;
    }
    if (/^npx (\S+)/.test(cmd)) {
      const bin = /^npx (\S+)/.exec(cmd)[1];
      const dep = { abaplint: '@abaplint/cli', abap2ui5lint: '@abap2ui5/linter' }[bin];
      if (dep) {
        assert.ok(pkg.devDependencies?.[dep],
          `CI runs "${cmd}" and the project does not depend on ${dep}`);
      }
    }
  }
});

test('the framework pin gate actually runs in a scaffolded project', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-scaffold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  materialise(dir);

  // The real thing: the first dependency-free step of the project's CI, run in
  // the project. It used to die on MODULE_NOT_FOUND before doing any work.
  let out;
  try {
    out = execFileSync(process.execPath, ['scripts/check-pin.mjs'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    assert.fail(`check:pin failed in a scaffolded project:\n${err.stdout || ''}${err.stderr || ''}`);
  }
  assert.match(out, /names one framework release, everywhere - OK/);
  // README is the template's, not the project's - the gate has to survive that.
  assert.ok(!fs.existsSync(path.join(dir, 'README.md')));
});

test('a scaffolded project carries no command pointing at a file it lacks', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-scaffold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  materialise(dir);

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const [name, body] of Object.entries(pkg.scripts)) {
    for (const [, target] of body.matchAll(/node\s+(scripts\/[\w./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(dir, target)),
        `the project's "${name}" script runs ${target}, which it did not receive`);
    }
    for (const [, inner] of body.matchAll(/npm run ([\w:]+)/g)) {
      assert.ok(pkg.scripts[inner], `the project's "${name}" chains to "${inner}", which it does not have`);
    }
  }
});

test('the class the project receives is the renamed one, in source and sidecar', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-scaffold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  materialise(dir);

  const abap = path.join(dir, 'src', `${NEW_CLASS}.clas.abap`);
  const xml = path.join(dir, 'src', `${NEW_CLASS}.clas.xml`);
  assert.ok(fs.existsSync(abap), 'the source was not renamed');
  assert.ok(fs.existsSync(xml), 'the sidecar was not renamed');
  assert.match(fs.readFileSync(abap, 'utf8'), new RegExp(NEW_CLASS));
  assert.match(fs.readFileSync(xml, 'utf8'), new RegExp(NEW_CLASS.toUpperCase()));
  // abapGit reads the sidecar as UTF-8 with a BOM; abaplint's xml_bom now says so.
  assert.equal(fs.readFileSync(xml)[0], 0xef, 'the sidecar lost its BOM on the way into the project');
});
