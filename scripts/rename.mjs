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
// WHAT IT RENAMES IS NOT WRITTEN HERE. `template.json` describes it - the
// placeholder class, which files carry which name, and which files a new
// project gets at all - because two other programs personalise this same
// template and must agree with this one: abap2UI5/mcp-server's `scaffold_app`
// tool serves the template to an agent, and the VS Code extension's "New
// Project from Template" writes it into a folder. One description, three
// executors.
//
// Usage:
//   node scripts/rename.mjs --class zcl_my_app [--package "My App"] [--repo my-app]
//   node scripts/rename.mjs --class zcl_my_app --dry
//
// Nothing outside this repository is touched, and it is a plain file rewrite:
// `git diff` shows you everything before you commit it.
//
// The edits themselves - the class in both spellings, an XML element, a JSON
// key - are in scripts/lib/substitute.mjs, because the published
// `create-abap2ui5-app` package (create/) makes the same edits over the same
// description and the two must not drift. This file decides WHICH files, from
// template.json; that one decides HOW.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyClass, applyElement, applyJsonKey, classNameProblem, substitutePath } from './lib/substitute.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SPEC = JSON.parse(readFileSync(join(ROOT, 'template.json'), 'utf8'));
const OLD_CLASS = SPEC.placeholderClass;
const SUBS = SPEC.substitutions;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const DRY = argv.includes('--dry');

const newClass = (flag('class') || '').toLowerCase();
const newPackage = flag('package');
const newRepo = flag('repo');

if (!newClass) {
  console.error(`usage: node scripts/rename.mjs --class <zcl_your_app> [--package "Your App"] [--repo your-app]

  --class    the app class, lower case. Must match this repository's
             object_naming rule (^ZCL_ or ^ZCX_) and stay within 30
             characters - or change the rule in abaplint.jsonc first.
  --package  the ABAP package description shown in abapGit (CTEXT)
  --repo     the repository name recorded in .abapgit.xml
  --dry      print what would change, write nothing`);
  process.exit(2);
}
const refused = classNameProblem(newClass, SUBS.class);
if (refused) {
  console.error(`rename: ${refused}`);
  process.exit(2);
}
if (newClass === OLD_CLASS) {
  console.error('rename: that is the name it already has');
  process.exit(2);
}

/* The three substitution kinds template.json can ask for are executed by
 * scripts/lib/substitute.mjs - one function each, shared with create/. A new
 * kind over there is one function there and one pass here. */

const changes = [];
const edit = (file, fn) => {
  const at = join(ROOT, file);
  if (!existsSync(at)) return;
  const before = readFileSync(at, 'utf8');
  const after = fn(before);
  if (before === after) return;
  changes.push({ file, before, after });
};

// 1. the class, wherever template.json says it is written - the ABAP, the
//    CLSNAME of its sidecar, and the documentation that names it
for (const file of SUBS.class.files) {
  edit(file, (t) => applyClass(t, OLD_CLASS, newClass));
}

// 2. the package description abapGit shows
if (newPackage) {
  for (const { file, element } of SUBS.packageText) {
    edit(file, (t) => applyElement(t, element, newPackage));
  }
}

// 3. the repository name, and npm's idea of it
if (newRepo) {
  for (const target of SUBS.repo) {
    edit(target.file, (t) =>
      target.element
        ? applyElement(t, target.element, newRepo)
        : applyJsonKey(t, target.jsonKey, newRepo));
  }
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

// The class name is in the FILE names too, and template.json says so.
const renames = SUBS.class.renamesPath
  ? SUBS.class.files
      .filter((f) => f.includes(OLD_CLASS) && existsSync(join(ROOT, f)))
      .map((f) => [f, substitutePath(f, OLD_CLASS, newClass, SUBS.class.renamesPath)])
  : [];
for (const [from, to] of renames) console.log(`  ${from}  ->  ${to}`);

if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

for (const c of changes) writeFileSync(join(ROOT, c.file), c.after);
for (const [from, to] of renames) renameSync(join(ROOT, from), join(ROOT, to));

console.log(`
Done. Two things this could not do for you:

  LICENSE      still carries "Copyright (c) 2026 abap2UI5". It is MIT, so you
               may keep, change or replace it - but it is your project now.
  abapGit      start the app with ?app_start=${newClass.toUpperCase()}

Then: npm run check`);
