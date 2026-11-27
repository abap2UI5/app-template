#!/usr/bin/env node
/*
 * add-addon — register an addon of github.com/abap2UI5-addons with the lint
 * gate, with everything it depends on.
 *
 *   npm run add-addon -- popups            add popups and what it needs
 *   npm run add-addon -- popups se16n      several at once
 *   npm run add-addon -- --list            the addons this knows, and which are registered
 *   npm run add-addon -- popups --dry      say what would change, write nothing
 *
 * `abaplint.jsonc` lists what abaplint clones to resolve the classes an app
 * calls, and out of the box that is the abap2UI5 framework alone. An app that
 * calls `z2ui5_cl_popup_to_confirm=>factory( )` therefore fails
 * `npm run check:abap` with "Class ... not found" - which says the GATE does
 * not know the addon, not that the call is wrong. This adds the addon to
 * `dependencies`, and first every addon it depends on (popups needs
 * layout-management), each once, in install order.
 *
 * THE PIN. abaplint clones a dependency with `git clone --depth 1 -b <branch>`
 * (its only key is "branch"), and `-b` takes a branch or a tag - never a
 * commit. So an addon can be held still exactly where it has a tag:
 *
 *   an addon that carries a release tag equal to the framework release this
 *   repository pins (popups, layout-management, ... tag `1.151.0` next to
 *   abap2UI5's `1.151.0`) is pinned to that tag - the pair somebody installs;
 *
 *   an addon without that tag follows its DEFAULT BRANCH (`main`, for some
 *   `standard`), and the output and the comment written next to it say so.
 *   That lint can change without a commit here. The one way to hold such an
 *   addon at a commit is a checkout of your own at the entry's "folder":
 *   abaplint reads a dependency from there when the folder holds files, and
 *   clones only when it does not.
 *
 * A second run moves a release-tag pin along when the framework pin moved,
 * and leaves every other entry alone.
 *
 * `.github/abaplint/abap_702.jsonc` (the 7.02 downport of
 * scripts/check-702.mjs) gets the same addons where it exists: at
 * `<release>-702` when the addon has that tag, else its `702` branch, and not
 * at all - said in the output - when the addon has neither.
 *
 * The files are edited as TEXT: the new entries are inserted before the
 * closing bracket of `dependencies`, and nothing else in the file is touched -
 * it is JSONC with comments that explain the pin, and a parse-and-serialise
 * would delete every one of them.
 *
 * Where the facts come from: scripts/addons.json, a snapshot of the addon
 * catalogue (https://abap2ui5-addons.github.io/addons.json) and of each
 * repository's branches and tags. Offline, the same answer every time; the
 * template refreshes it daily, a project takes a newer one by copying the file
 * from the template's `main`.
 *
 * What this does NOT do: install anything on a system. An addon is a
 * repository of its own that the system pulls with abapGit next to abap2UI5 -
 * the run ends with the order.
 *
 * `npm run doctor` uses `missingAddons` below: an app class that names an
 * addon's class while abaplint.jsonc does not list the addon gets a FAIL line
 * with this command as its remedy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG = 'abaplint.jsonc';
export const CONFIG_702 = '.github/abaplint/abap_702.jsonc';
const SNAPSHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'addons.json');

export const loadCatalog = (file = SNAPSHOT) => JSON.parse(fs.readFileSync(file, 'utf8')).addons;

const keyOf = (a) => `${a.org}/${a.repo}`;
const urlOf = (a) => `https://github.com/${a.org}/${a.repo}`;

/* ------------------------------------------------------------- the catalogue */

/** `popups`, `abap2UI5-addons/popups` or its GitHub address -> the record, or
 *  null. A bare name is looked up among the addons first and may not be
 *  ambiguous across organisations. */
export function findAddon(catalog, name) {
  const wanted = String(name).trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
  if (wanted.includes('/')) return catalog.find((a) => keyOf(a).toLowerCase() === wanted) ?? null;
  const hits = catalog.filter((a) => a.repo.toLowerCase() === wanted);
  return hits.length === 1 ? hits[0] : null;
}

/** The addons asked for and everything they depend on, each once,
 *  dependencies before what needs them. Throws on a name the snapshot does
 *  not have, naming the nearest ones. */
export function resolveAddons(catalog, names) {
  const order = [];
  const seen = new Set();
  const visit = (addon, trail) => {
    if (seen.has(keyOf(addon))) return;
    if (trail.includes(keyOf(addon))) throw new Error(`the snapshot's dependencies run in a circle: ${[...trail, keyOf(addon)].join(' -> ')}`);
    for (const dep of addon.dependsOn) {
      const next = findAddon(catalog, dep);
      if (!next) throw new Error(`${keyOf(addon)} depends on ${dep}, which scripts/addons.json does not have - the snapshot is incomplete`);
      visit(next, [...trail, keyOf(addon)]);
    }
    seen.add(keyOf(addon));
    order.push(addon);
  };
  for (const name of names) {
    const addon = findAddon(catalog, name);
    if (!addon) {
      const near = catalog.filter((a) => a.repo.toLowerCase().includes(String(name).toLowerCase().replace(/^.*\//, '')) && a.repo).map((a) => a.repo);
      throw new Error(`"${name}" is not an addon scripts/addons.json knows`
        + `${near.length ? ` - did you mean ${near.join(', ')}?` : ''}\n  \`npm run add-addon -- --list\` prints them all`);
    }
    visit(addon, []);
  }
  return order;
}

/* ------------------------------------------------------------- the pin */

const RELEASE = /^\d+\.\d+\.\d+(-702)?$/;

/** What abaplint is told to clone. `framework` is the framework release the
 *  repository pins (null when it pins none); `downport` asks for the 7.02
 *  line. Returns null when the 7.02 line does not exist for this addon. */
export function choosePin(addon, framework, { downport = false } = {}) {
  if (downport) {
    if (framework && addon.tags.includes(`${framework}-702`)) return { branch: `${framework}-702`, pinned: true };
    if (addon.branch702) return { branch: '702', pinned: false };
    return null;
  }
  if (framework && addon.tags.includes(framework)) return { branch: framework, pinned: true };
  return { branch: addon.branch, pinned: false };
}

/* ------------------------------------------------------------- the JSONC text */

/** The text with every comment blanked out, character for character, so an
 *  offset found in the result is an offset in the original. Strings stay. */
export function blankComments(text) {
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n\r]/g, ' ');
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j++;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') j++;
      out += blank(text.slice(i, j));
      i = j;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, j));
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Where `dependencies` is in an abaplint config: the offset of its closing
 *  bracket, and every entry with its url and the offsets of its "branch"
 *  value. Throws when the file has no such array. */
export function findDependencies(text) {
  const code = blankComments(text);
  const head = /"dependencies"\s*:\s*\[/.exec(code);
  if (!head) throw new Error('no "dependencies": [ ... ] array');
  const open = head.index + head[0].length - 1;
  const entries = [];
  let depth = 0;
  let start = -1;
  let close = -1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"') {
      i++;
      while (i < code.length && code[i] !== '"') i += code[i] === '\\' ? 2 : 1;
    } else if (c === '[' || c === '{') {
      if (c === '{' && depth === 1) start = i;
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
      if (c === '}' && depth === 1) {
        const body = code.slice(start, i + 1);
        const url = /"url"\s*:\s*"([^"]*)"/.exec(body)?.[1] ?? null;
        const b = /"branch"\s*:\s*"([^"]*)"/.exec(body);
        entries.push({
          start,
          end: i + 1,
          url,
          branch: b ? b[1] : null,
          branchAt: b ? start + b.index + b[0].length - 1 - b[1].length : -1,
        });
      }
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error('the "dependencies" array is never closed');
  return { open, close, entries };
}

const sameRepo = (url, addon) => String(url ?? '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase() === urlOf(addon).toLowerCase();

/** One dependency entry, indented like the entries already there. */
export function renderEntry(addon, pin, indent, framework) {
  const inner = `${indent}  `;
  const why = pin.pinned
    ? `Pinned to its release tag ${pin.branch}, the one cut for abap2UI5 ${framework}.`
    : `NOT pinned: it has no release tag ${pin.branch === '702' ? `${framework ?? '<release>'}-702` : framework ?? 'to pin'}, so this follows its branch \`${pin.branch}\``;
  const lines = [
    `${indent}{`,
    `${inner}// ${keyOf(addon)} - added by \`npm run add-addon\`.`,
    `${inner}// A separate abapGit install on the system; here abaplint clones it to`,
    `${inner}// resolve its classes.`,
    `${inner}// ${why}`,
  ];
  if (!pin.pinned) {
    lines.push(`${inner}// ("branch" goes to \`git clone -b\`: a branch or a tag, never a commit.`);
    lines.push(`${inner}// A checkout of your own at "folder" is read instead of the clone.)`);
  }
  lines.push(`${inner}"url": "${urlOf(addon)}",`);
  lines.push(`${inner}"branch": "${pin.branch}",`);
  lines.push(`${inner}"folder": "/${addon.repo}",`);
  lines.push(`${inner}"files": "/src/**/*.*"`);
  lines.push(`${indent}}`);
  return lines.join('\n');
}

/**
 * The config text with the addons registered. `addons` is in install order.
 * Returns the new text and, per addon, what happened:
 *   added     - a new entry, with the pin it got
 *   present   - an entry for that repository was already there, left alone
 *   repinned  - it was there at another RELEASE tag, and the tag was moved
 *   absent    - (7.02 only) the addon has no 7.02 line; nothing was written
 */
export function registerAddons(text, addons, framework, { downport = false } = {}) {
  const report = [];
  let out = text;
  for (const addon of addons) {
    const deps = findDependencies(out);
    const pin = choosePin(addon, framework, { downport });
    const existing = deps.entries.find((e) => sameRepo(e.url, addon));
    if (!pin) {
      report.push({ addon, what: existing ? 'present' : 'absent', branch: existing?.branch ?? null, pinned: false });
      continue;
    }
    if (existing) {
      if (pin.pinned && existing.branch && RELEASE.test(existing.branch) && existing.branch !== pin.branch) {
        out = out.slice(0, existing.branchAt) + pin.branch + out.slice(existing.branchAt + existing.branch.length);
        report.push({ addon, what: 'repinned', branch: pin.branch, was: existing.branch, pinned: true });
      } else {
        report.push({ addon, what: 'present', branch: existing.branch, pinned: Boolean(existing.branch && RELEASE.test(existing.branch)) });
      }
      continue;
    }
    const last = deps.entries.at(-1);
    const eol = out.includes('\r\n') ? '\r\n' : '\n';
    let indent = '    ';
    if (last) {
      const lineStart = out.lastIndexOf('\n', last.start) + 1;
      indent = /^[ \t]*/.exec(out.slice(lineStart, last.start))[0];
    }
    const entry = renderEntry(addon, pin, indent, framework).split('\n').join(eol);
    out = last
      ? `${out.slice(0, last.end)},${eol}${entry}${out.slice(last.end)}`
      : `${out.slice(0, deps.close)}${eol}${entry}${eol}  ${out.slice(deps.close)}`;
    report.push({ addon, what: 'added', branch: pin.branch, pinned: pin.pinned });
  }
  return { text: out, report };
}

/** The framework release an abaplint config pins: the "branch" of its
 *  abap2UI5/abap2UI5 dependency when that is a release tag (the 7.02 config
 *  writes it `<release>-702`); null when there is none or it follows a branch. */
export function frameworkPin(text) {
  let entries = [];
  try {
    entries = findDependencies(text).entries;
  } catch { /* no dependencies, no pin */ }
  const core = entries.find((e) => /^https:\/\/github\.com\/abap2ui5\/abap2ui5(\.git)?\/?$/i.test(e.url ?? ''));
  return /^(\d+\.\d+\.\d+)(-702)?$/.exec(core?.branch ?? '')?.[1] ?? null;
}

/* ------------------------------------------------------------- the hint */

/** `z2ui5_cl_popup_to_confirm` -> `popup`: the part of an addon's names that
 *  is its own. Null when its entry points do not share one. */
export function familyOf(addon) {
  const parts = addon.entryPoints.map((n) => /^z2ui5_(?:cl|cx|if)_([a-z0-9]+)(?:_|$)/.exec(n)?.[1] ?? '');
  return parts.length && parts[0] && parts.every((p) => p === parts[0]) ? parts[0] : null;
}

/** ABAP source without its comments and literals - what is left is code, and
 *  a class named in a comment is not a class the gate has to resolve. */
export function abapCode(source) {
  return source.split(/\r?\n/).map((line) => {
    if (line.startsWith('*')) return '';
    let out = '';
    let quote = '';
    for (const c of line) {
      if (quote) {
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"') break;
      if (c === "'" || c === '`' || c === '|') {
        quote = c;
        continue;
      }
      out += c;
    }
    return out;
  }).join('\n');
}

/**
 * The addon classes the sources name that the lint config cannot resolve.
 * `sources` is [{ file, text }], `own` the lower-case names of the objects the
 * project defines itself. One finding per missing addon:
 *   { addon, names: [...], exact: true when a name is one of its entry points }
 */
export function missingAddons(sources, configText, catalog, own = new Set()) {
  let registered = [];
  try {
    registered = findDependencies(configText).entries;
  } catch { /* a config without dependencies registers none */ }
  const candidates = catalog
    .filter((a) => a.entryPoints.length && !registered.some((e) => sameRepo(e.url, a)))
    .map((a) => ({ addon: a, entry: new Set(a.entryPoints), family: familyOf(a) }));
  const found = new Map();
  for (const { text } of sources) {
    for (const [name] of abapCode(text).toLowerCase().matchAll(/\bz2ui5_(?:cl|cx|if)_[a-z0-9_]+/g)) {
      if (own.has(name)) continue;
      const hit = candidates.find((c) => c.entry.has(name))
        ?? candidates.find((c) => c.family && new RegExp(`^z2ui5_(?:cl|cx|if)_${c.family}(?:_|$)`).test(name));
      if (!hit) continue;
      const rec = found.get(keyOf(hit.addon)) ?? { addon: hit.addon, names: new Set(), exact: false };
      rec.names.add(name);
      rec.exact ||= hit.entry.has(name);
      found.set(keyOf(hit.addon), rec);
    }
  }
  return [...found.values()].map((r) => ({ ...r, names: [...r.names].sort() }));
}

/** Registered addons whose release-tag pin is not the framework's any more. */
export function stalePins(configText, catalog) {
  const framework = frameworkPin(configText);
  if (!framework) return [];
  return findDependencies(configText).entries.flatMap((e) => {
    const addon = catalog.find((a) => sameRepo(e.url, a));
    if (!addon || !e.branch || !RELEASE.test(e.branch) || e.branch === framework) return [];
    return [{ addon, branch: e.branch, framework, available: addon.tags.includes(framework) }];
  });
}

/* ------------------------------------------------------------- the I/O */

function list(catalog, root) {
  const cfg = fs.existsSync(path.join(root, CONFIG)) ? fs.readFileSync(path.join(root, CONFIG), 'utf8') : '';
  let registered = [];
  try {
    registered = findDependencies(cfg).entries;
  } catch { /* none */ }
  console.log('add-addon: the addons scripts/addons.json knows (* = registered in abaplint.jsonc)\n');
  for (const a of catalog) {
    const mark = registered.some((e) => sameRepo(e.url, a)) ? '*' : ' ';
    console.log(`${mark} ${a.repo}${a.org === 'abap2UI5-addons' ? '' : `  (${a.org})`}${a.tagline ? ` - ${a.tagline}` : ''}`);
    if (a.useWhen) console.log(`    ${a.useWhen}`);
    if (a.entryPoints.length) console.log(`    classes: ${a.entryPoints.join(', ')}`);
    if (a.dependsOn.length) console.log(`    needs:   ${a.dependsOn.join(', ')}`);
  }
  console.log('\nnpm run add-addon -- <repo>   registers one, with what it needs. The catalogue: https://abap2ui5-addons.github.io/');
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const names = args.filter((a) => !a.startsWith('--'));
  const unknown = [...flags].filter((f) => !['--list', '--dry', '--help'].includes(f));
  const root = ROOT;
  const catalog = loadCatalog();

  if (flags.has('--list')) return list(catalog, root);
  if (unknown.length || flags.has('--help') || !names.length) {
    if (unknown.length) console.error(`add-addon: unknown option ${unknown.join(', ')}`);
    console.error('usage: npm run add-addon -- <repo> [<repo> ...] [--dry]\n       npm run add-addon -- --list');
    process.exit(flags.has('--help') && !unknown.length ? 0 : 2);
  }
  const DRY = flags.has('--dry');

  let addons;
  try {
    addons = resolveAddons(catalog, names);
  } catch (err) {
    console.error(`add-addon: ${err.message}`);
    process.exit(1);
  }

  const file = path.join(root, CONFIG);
  if (!fs.existsSync(file)) {
    console.error(`add-addon: ${CONFIG} is not here - this registers addons with the abaplint gate, and there is none to register them with`);
    process.exit(1);
  }
  const before = fs.readFileSync(file, 'utf8');
  const framework = frameworkPin(before);
  let main_;
  try {
    main_ = registerAddons(before, addons, framework);
  } catch (err) {
    console.error(`add-addon: ${CONFIG}: ${err.message} - add \`"dependencies": []\` next to "global" and run this again`);
    process.exit(1);
  }

  const file702 = path.join(root, CONFIG_702);
  let down = null;
  let before702 = null;
  if (fs.existsSync(file702)) {
    before702 = fs.readFileSync(file702, 'utf8');
    try {
      down = registerAddons(before702, addons, frameworkPin(before702) ?? framework, { downport: true });
    } catch (err) {
      console.error(`add-addon: ${CONFIG_702}: ${err.message} - left as it is`);
    }
  }

  const say = (label, r) => {
    const name = keyOf(r.addon).padEnd(34);
    if (r.what === 'added') console.log(`  ${label} + ${name} ${r.pinned ? `pinned to release tag ${r.branch}` : `branch ${r.branch} - NOT pinned`}`);
    else if (r.what === 'repinned') console.log(`  ${label} ~ ${name} release tag ${r.was} -> ${r.branch}`);
    else if (r.what === 'present') console.log(`  ${label} = ${name} already registered${r.branch ? ` (${r.branch})` : ''}`);
    else console.log(`  ${label} ! ${name} has no 702 branch - not registered there`);
  };
  console.log(`add-addon: ${DRY ? 'would register' : 'registering'} ${addons.map((a) => a.repo).join(', ')}${framework ? ` next to abap2UI5 ${framework}` : ' (this repository pins no framework release)'}`);
  console.log(`${CONFIG}:`);
  for (const r of main_.report) say('', r);
  if (down) {
    console.log(`${CONFIG_702}:`);
    for (const r of down.report) say('', r);
  }

  const changed = main_.text !== before || (down && down.text !== before702);
  if (!DRY) {
    if (main_.text !== before) fs.writeFileSync(file, main_.text);
    if (down && down.text !== before702) fs.writeFileSync(file702, down.text);
  }
  if (!changed) console.log('\nNothing to change - every one of them is registered.');
  else if (DRY) console.log('\n--dry: nothing was written.');

  const loose = main_.report.filter((r) => r.what === 'added' && !r.pinned);
  if (loose.length) {
    console.log(`\nNot pinned: ${loose.map((r) => `${r.addon.repo} (${r.branch})`).join(', ')}.`);
    console.log(`  ${loose.length === 1 ? 'It has' : 'They have'} no release tag${framework ? ` ${framework}` : ''}, and abaplint's "branch" is passed to \`git clone -b\`,`);
    console.log('  which takes a branch or a tag and never a commit. The lint follows that branch: it can');
    console.log('  change without a commit here. To hold one at a commit, check it out yourself at the');
    console.log('  entry\'s "folder" - abaplint reads the folder when it holds files and skips the clone.');
  }
  const none702 = down?.report.filter((r) => r.what === 'absent') ?? [];
  if (none702.length) {
    console.log(`\nNo 7.02 line: ${none702.map((r) => r.addon.repo).join(', ')} - \`node scripts/check-702.mjs\` cannot resolve ${none702.length === 1 ? 'its' : 'their'} classes.`);
  }

  console.log('\nOn the system - each is a repository of its own, pulled with abapGit, in this order:');
  let n = 1;
  console.log(`  ${n++}. https://github.com/abap2UI5/abap2UI5${framework ? `  (release ${framework} or newer)` : ''}`);
  for (const a of addons) {
    console.log(`  ${n++}. ${urlOf(a)}  (branch ${a.branch}${a.branch702 ? '; 702 on NetWeaver 7.02 - 7.40' : ''})`);
  }
  console.log(`  ${n}. this repository`);
  console.log('An addon is NOT part of abap2UI5: an app that calls one does not activate on a system that has not pulled it.');
  console.log(`\nNext: \`npm run check:abap\` - abaplint clones ${addons.length === 1 ? 'it' : 'them'} on the run (network).`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
