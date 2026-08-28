#!/usr/bin/env node
/*
 * check-template — `template.json` is a claim about THIS repository, and two
 * other repositories act on it.
 *
 * `template.json` says which files a new project gets and which text in them
 * carries a name. `scripts/rename.mjs` executes that here; abap2UI5/mcp-server's
 * `scaffold_app` executes it over a checkout of this repository; the VS Code
 * extension snapshots it for "New Project from Template". So a file that is
 * listed and does not exist, or exists and is not listed, is not a typo in a
 * config - it is a project somebody else hands out with a file missing from
 * it, and nothing over there can tell the difference between "deliberately
 * dropped" and "forgotten".
 *
 * Which is why it runs offline, with no dependencies, on a claim no downstream
 * repository can verify.
 *
 * It carries three more checks, all of the same shape - a claim this repository
 * makes that only it can test:
 *
 *   the shared set is CLOSED under what it invokes. A handed-out package.json
 *   or workflow may only name scripts and npm scripts that are handed out too.
 *   This is the one that was missing, and four of a generated project's seven
 *   CI steps failed on it.
 *
 *   a class name `rename` blesses is one `abaplint.jsonc` accepts.
 *
 *   the linter/render-runtime pairing is installable - checked in both
 *   directions, since the published peer range moves without this repository.
 *
 * It does NOT run from the shared package.json, for the reason it exists to
 * enforce: a project has no template.json to gate.
 *
 *   node scripts/check-template.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'template.json'), 'utf8'));

const problems = [];
const has = (file) => fs.existsSync(path.join(ROOT, file));

const shared = SPEC.files.shared;
const named = SPEC.files.named;
const templateOwn = Object.keys(SPEC.files.templateOwn);

for (const file of [...shared, ...named]) {
  if (!has(file)) problems.push(`template.json lists "${file}" - this repository does not have it`);
}
for (const file of templateOwn) {
  if (!has(file)) problems.push(`template.json excludes "${file}" - a file that is not here any more should not need excluding`);
}

/* Every file this repository would hand out has to be accounted for: in
 * shared, in named, or excluded WITH a reason. Anything else is a file
 * somebody added and nobody decided about.
 *
 * `scripts/` used to be exempt from this walk as "a directory decision", and
 * that is how scripts/check-pin.mjs could be named by the SHARED package.json
 * while staying behind: the one directory whose listing churns most was the one
 * nothing checked. It is now walked like every other, and a templateOwn key
 * that names a DIRECTORY covers everything under it - so a whole directory can
 * still be excluded once, with its reason, instead of file by file. */
const IGNORED = new Set(['.git', 'node_modules', '.playwright', 'template.json']);
const walk = (dir, prefix = '') => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir || '.'), { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    else yieldFile(rel);
  }
};
const seen = new Set([...shared, ...named, ...templateOwn]);
const ownDirs = templateOwn.filter((f) => has(f) && fs.statSync(path.join(ROOT, f)).isDirectory());
const unaccounted = [];
function yieldFile(rel) {
  if (seen.has(rel)) return;
  if (ownDirs.some((d) => rel.startsWith(`${d}/`))) return;
  unaccounted.push(rel);
}
walk('');
for (const file of unaccounted) {
  problems.push(`"${file}" is in this repository but template.json neither hands it out nor excludes it - add it to files.shared/files.named, or to files.templateOwn with the reason`);
}

// The placeholder class has to be the class that is actually here, in both
// the source and its sidecar - that pairing is the reason rename exists.
const cls = SPEC.placeholderClass;
for (const ext of ['clas.abap', 'clas.xml']) {
  if (!has(`src/${cls}.${ext}`)) problems.push(`template.json's placeholderClass is "${cls}" but src/${cls}.${ext} is not here`);
}

for (const file of SPEC.substitutions.class.files) {
  if (!has(file)) continue;
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (!text.includes(cls) && !text.includes(cls.toUpperCase())) {
    problems.push(`substitutions.class lists "${file}", which does not mention ${cls} - a rename would silently do nothing to it`);
  }
}
for (const { file, element } of SPEC.substitutions.packageText) {
  if (!has(file) || !new RegExp(`<${element}>`).test(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
    problems.push(`substitutions.packageText names <${element}> in "${file}", which is not there`);
  }
}
for (const target of SPEC.substitutions.repo) {
  const text = has(target.file) ? fs.readFileSync(path.join(ROOT, target.file), 'utf8') : '';
  const pattern = target.element ? new RegExp(`<${target.element}>`) : new RegExp(`"${target.jsonKey}":`);
  if (!pattern.test(text)) {
    problems.push(`substitutions.repo names ${target.element ? `<${target.element}>` : `"${target.jsonKey}"`} in "${target.file}", which is not there`);
  }
}

/* A SHARED file may only point at files a project actually receives.
 *
 * This is the rule that was missing. `package.json` and
 * `.github/workflows/check.yml` are both handed out; `scripts/` mostly is not.
 * So the generated project's first push ran `npm run check:pin`,
 * `npm run check:template` and `npm run check:agents` - three scripts whose
 * `node scripts/*.mjs` was not in the box - and then `npm ci` with no lockfile.
 * Four of seven steps failed before abaplint started. "Use this template" on
 * GitHub copies everything and hid it; scaffold_app and the VS Code extension,
 * the two paths template.json exists for, did not.
 *
 * Nothing about that was a typo, which is why prose could not have caught it:
 * every individual file was listed correctly. What was never checked is whether
 * the listing is CLOSED under "what the shared files invoke". */
const sharedSet = new Set(shared);
const scriptRefs = /(?:^|[\s'"&|])node\s+(scripts\/[\w./-]+)/g;
const invokers = [
  { file: 'package.json', text: () => JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts) },
  ...shared.filter((f) => f.endsWith('.yml')).map((f) => ({ file: f, text: () => fs.readFileSync(path.join(ROOT, f), 'utf8') })),
];
const npmScripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {};
for (const inv of invokers) {
  if (!has(inv.file)) continue;
  const text = inv.text();
  for (const [, target] of text.matchAll(scriptRefs)) {
    if (!sharedSet.has(target)) {
      problems.push(`"${inv.file}" is handed out and runs "node ${target}", which is not in files.shared - `
        + 'a project gets the caller without the callee, and the failure is a MODULE_NOT_FOUND '
        + 'in its first CI run');
    }
  }
}
/* The same closure one level up: a shared workflow that runs `npm run X` needs
 * X to exist in the shared package.json, and `npm ci` needs the lockfile. */
for (const f of shared.filter((x) => x.endsWith('.yml'))) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [, name] of text.matchAll(/run:\s*npm run ([\w:]+)/g)) {
    if (!npmScripts[name]) {
      problems.push(`"${f}" is handed out and runs "npm run ${name}", which the shared package.json does not define`);
    }
  }
  if (/run:\s*npm ci\b/.test(text) && !sharedSet.has('package-lock.json')) {
    problems.push(`"${f}" is handed out and runs "npm ci", which fails without a lockfile - `
      + 'add package-lock.json to files.shared or use `npm install`');
  }
}

/* A name this template blesses has to be a name its own lint accepts.
 * substitutions.class.rule used to admit ycl_/ycx_ while abaplint.jsonc's
 * object_naming is ^ZCL_|^ZCX_ - so `rename --class ycl_my_app` passed
 * validation and then failed `npm run check`, which is the one thing a
 * scaffolding step must never do. */
const lintCfg = fs.readFileSync(path.join(ROOT, 'abaplint.jsonc'), 'utf8');
const clasRule = /"clas":\s*"([^"]+)"/.exec(lintCfg)?.[1];
if (clasRule) {
  const objectNaming = new RegExp(clasRule, 'i');
  const probes = ['zcl_app_001', 'zcx_app_001', 'ycl_app_001', 'ycx_app_001', 'zif_app_001'];
  for (const probe of probes) {
    const blessed = new RegExp(SPEC.substitutions.class.rule).test(probe);
    const linted = objectNaming.test(probe);
    if (blessed && !linted) {
      problems.push(`substitutions.class.rule accepts "${probe}" but abaplint.jsonc's object_naming.clas `
        + `(${clasRule}) rejects it - a rename would produce a repository that fails its own gate`);
    }
  }
}

/* Every file a substitution names has to be a file somebody receives.
 * README.md was listed as a class-substitution target and excluded from the
 * handout, so of the three executors only the in-place rename ever touched it -
 * a legitimate divergence with nothing saying so. */
for (const file of SPEC.substitutions.class.files) {
  if (!sharedSet.has(file) && !named.includes(file)) {
    problems.push(`substitutions.class names "${file}", which is neither shared nor named - `
      + 'only the in-place rename would reach it, so the three executors would diverge on it');
  }
}

/* One more claim this repository makes about itself, and the only one with an
 * expiry date. `@abap2ui5/linter` and `@abap2ui5/render-runtime` are cut from
 * one tag and the render gate wants the same minor line. Whether that pairing
 * is installable is decided by the PUBLISHED linter's peer range, which moves
 * without this repository: 0.2.1 declared `peerOptional render-runtime ^0.1.0`
 * and needed an `overrides` block; 0.2.2 widened the range and made that block
 * obsolete; 0.5.1 accepts `^0.5.0` outright. So this checks the invariant in
 * both directions - an override that is now unnecessary, and a missing one that
 * is now required - rather than the state of any one release. The lockfile
 * records the peer range, so it is answerable offline, before any install. */
const lockFile = path.join(ROOT, 'package-lock.json');
if (fs.existsSync(lockFile)) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const override = pkg.overrides?.['@abap2ui5/linter']?.['@abap2ui5/render-runtime'];
  const peer = lock.packages?.['node_modules/@abap2ui5/linter']
    ?.peerDependencies?.['@abap2ui5/render-runtime'];
  const want = pkg.devDependencies?.['@abap2ui5/render-runtime'];
  // The range is a literal comparison on purpose: "does it mention the major
  // line we ask for" is all this needs, and it beats a semver dependency in a
  // script that has to run before `npm ci`.
  const wantMajor = String(want || '').replace(/^[\^~]/, '').split('.').slice(0, 2).join('.');
  if (override && peer && peer.includes(wantMajor)) {
    problems.push(`the published @abap2ui5/linter now accepts render-runtime ${peer} - `
      + "package.json's `overrides` block for it is obsolete, remove it and re-run `npm install`");
  }
  if (!override && peer && !peer.includes(wantMajor)) {
    problems.push(`the published @abap2ui5/linter accepts render-runtime ${peer}, not the ${want} `
      + 'this repository asks for - `npm ci` will refuse the pairing without an `overrides` block');
  }
}

if (problems.length) {
  console.error(`template.json does not describe this repository - ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nabap2UI5/mcp-server and abap2UI5/vscode-extension build a project from that description.');
  process.exit(1);
}
console.log(`template.json describes this repository - OK (${shared.length} shared, ${named.length} named, ${templateOwn.length} excluded)`);
