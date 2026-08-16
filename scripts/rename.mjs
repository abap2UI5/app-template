#!/usr/bin/env node
// Makes this template yours: renames the app class and retitles the package
// and the repository, in every file that carries the name.
//
// Why a script: after "Use this template" the repository is still called
// app-template in .abapgit.xml, its package still says "abap2UI5 app", and the
// class is still ZCL_APP_001 - four files, none of them obvious, and the one
// that bites is the class, because the name lives in the ABAP *and* in the
// CLSNAME of its .clas.xml. Renaming half of it gives you an object that
// abapGit imports under one name and ABAP activates under another.
//
// Usage:
//   npm run rename -- --class zcl_my_app [--package "My App"] [--repo my-app]
//   npm run rename -- --class zcl_my_app --dry
//
// Nothing outside this repository is touched, and it is a plain file rewrite:
// `git diff` shows you everything before you commit it.

import { readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const DRY = argv.includes('--dry');

const OLD_CLASS = 'zcl_app_001';
const newClass = (flag('class') || '').toLowerCase();
const newPackage = flag('package');
const newRepo = flag('repo');

if (!newClass) {
  console.error(`usage: npm run rename -- --class <zcl_your_app> [--package "Your App"] [--repo your-app]

  --class    the app class, lower case. Must match this repository's
             object_naming rule (^ZCL_ or ^ZCX_) and stay within 30
             characters - or change the rule in abaplint.jsonc first.
  --package  the ABAP package description shown in abapGit (CTEXT)
  --repo     the repository name recorded in .abapgit.xml
  --dry      print what would change, write nothing`);
  process.exit(2);
}
if (!/^z(cl|cx)_[a-z0-9_]+$/.test(newClass)) {
  console.error(`rename: "${newClass}" does not look like an ABAP class name (^zcl_ or ^zcx_, lower case, letters digits underscore)`);
  process.exit(2);
}
if (newClass.length > 30) {
  console.error(`rename: "${newClass}" is ${newClass.length} characters; ABAP allows 30`);
  process.exit(2);
}
if (newClass === OLD_CLASS) {
  console.error('rename: that is the name it already has');
  process.exit(2);
}

const changes = [];
const edit = (file, fn) => {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (before === after) return;
  changes.push({ file: file.slice(ROOT.length + 1), before, after });
};

// 1. the class, in the ABAP and in the CLSNAME of its sidecar
for (const name of readdirSync(SRC)) {
  if (!name.startsWith(OLD_CLASS)) continue;
  edit(join(SRC, name), (t) =>
    t.replaceAll(OLD_CLASS, newClass).replaceAll(OLD_CLASS.toUpperCase(), newClass.toUpperCase()));
}

// 2. the package description abapGit shows
if (newPackage) {
  edit(join(SRC, 'package.devc.xml'), (t) =>
    t.replace(/<CTEXT>[^<]*<\/CTEXT>/, `<CTEXT>${newPackage}</CTEXT>`));
}

// 3. the repository name, and npm's idea of it
if (newRepo) {
  edit(join(ROOT, '.abapgit.xml'), (t) => t.replace(/<NAME>[^<]*<\/NAME>/, `<NAME>${newRepo}</NAME>`));
  edit(join(ROOT, 'package.json'), (t) => t.replace(/"name":\s*"[^"]*"/, `"name": "${newRepo}"`));
}

// 4. the class name where the documentation names it
for (const doc of ['README.md', 'AGENTS.md']) {
  edit(join(ROOT, doc), (t) =>
    t.replaceAll(OLD_CLASS, newClass).replaceAll(OLD_CLASS.toUpperCase(), newClass.toUpperCase()));
}

if (changes.length === 0) {
  console.log('rename: nothing to change');
  process.exit(0);
}

console.log(`rename: ${OLD_CLASS} -> ${newClass}`);
if (newPackage) console.log(`        package  -> ${newPackage}`);
if (newRepo) console.log(`        repository -> ${newRepo}`);
console.log('');
for (const c of changes) console.log(`  ${c.file}`);

const renames = readdirSync(SRC)
  .filter((n) => n.startsWith(OLD_CLASS))
  .map((n) => [join(SRC, n), join(SRC, n.replace(OLD_CLASS, newClass))]);
for (const [from] of renames) console.log(`  ${from.slice(ROOT.length + 1)}  ->  ${from.slice(ROOT.length + 1).replace(OLD_CLASS, newClass)}`);

if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

for (const c of changes) writeFileSync(join(ROOT, c.file), c.after);
for (const [from, to] of renames) renameSync(from, to);

console.log(`
Done. Two things this could not do for you:

  LICENSE      still carries "Copyright (c) 2026 abap2UI5". It is MIT, so you
               may keep, change or replace it - but it is your project now.
  abapGit      start the app with ?app_start=${newClass.toUpperCase()}

Then: npm run check`);
