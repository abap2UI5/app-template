#!/usr/bin/env node
/*
 * check-template — `template.json` is a claim about THIS repository, and two
 * other repositories act on it.
 *
 * `template.json` says which files a new project gets and which text in them
 * carries a name. `scripts/rename.mjs` executes that here; abap2UI5/ai-mcp's
 * `scaffold_app` executes it over a checkout of this repository; the VS Code
 * extension snapshots it for "New Project from Template". So a file that is
 * listed and does not exist, or exists and is not listed, is not a typo in a
 * config - it is a project somebody else hands out with a file missing from
 * it, and nothing over there can tell the difference between "deliberately
 * dropped" and "forgotten".
 *
 * Which is why this runs in `npm run check`, offline, with no dependencies.
 *
 *   node scripts/check-template.mjs        (npm run check:template)
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
 * somebody added and nobody decided about. */
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
const unaccounted = [];
function yieldFile(rel) {
  // scripts/ and the excluded set are accounted for as a directory decision
  if (seen.has(rel) || rel.startsWith('scripts/')) return;
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

if (problems.length) {
  console.error(`template.json does not describe this repository - ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nabap2UI5/ai-mcp and abap2UI5/vscode-extension build a project from that description.');
  process.exit(1);
}
console.log(`template.json describes this repository - OK (${shared.length} shared, ${named.length} named, ${templateOwn.length} excluded)`);
