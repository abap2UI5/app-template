#!/usr/bin/env node
/*
 * sync-addons — scripts/addons.json is a SNAPSHOT, and this is what writes it.
 *
 * `npm run add-addon -- <repo>` (scripts/add-addon.mjs) registers an addon of
 * github.com/abap2UI5-addons in abaplint.jsonc, with everything it depends on.
 * It has to work offline and decide the same thing every time, in a project
 * that has no checkout of anything - so the facts it needs are vendored here,
 * in one data file that ships with a project, the way the mirrored guide and
 * the skills do.
 *
 * Two kinds of fact, from two places:
 *
 *   what an addon IS - repo, org, tagline, useWhen, entryPoints, dependsOn -
 *   is the addon catalogue's: abap2UI5-addons/abap2UI5-addons.github.io,
 *   `src/data/catalog.ts` and `src/data/addons/<repo>.json`. Read from a
 *   checkout next to this one when there is one, else from the catalogue's
 *   published projection https://abap2ui5-addons.github.io/addons.json
 *   (`{ schema: 1, addons: [ ... ] }`, the same records).
 *
 *   what can be CLONED - the default branch, whether a `702` branch exists,
 *   the release tags - is each repository's own, asked with
 *   `git ls-remote --symref`. abaplint clones a dependency with
 *   `git clone --depth 1 -b <branch>`, which takes a branch or a tag and
 *   nothing else, so these three are everything a pin can be made of.
 *
 *   node scripts/sync-addons.mjs           rewrite scripts/addons.json
 *   node scripts/sync-addons.mjs --check   fail if the catalogue's facts in it
 *                                          are out of date (what CI runs)
 *
 * `--check` compares the catalogue half only. The git half moves whenever an
 * addon cuts a release, and a pull request here must not go red because
 * another repository tagged something; the daily sync-mirrors run rewrites the
 * whole file and carries a new tag in its pull request. When the catalogue is
 * not reachable the run SAYS SO and passes, writing nothing - the rule
 * generate-agents.mjs states at more length. A repository whose refs cannot be
 * read keeps the git facts the snapshot already has, and the run says which.
 *
 * Which entries are taken: every catalogue entry outside the group
 * `developer-tools` (the linter, the editor extension, the MCP server and this
 * template are not ABAP an app calls), plus every repository some entry names
 * in `dependsOn`, in the catalogue or not - a dependency has to be clonable
 * even when nobody describes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'scripts', 'addons.json');
const SIBLING = path.join(ROOT, '..', 'abap2ui5-addons.github.io');
const PUBLISHED = 'https://abap2ui5-addons.github.io/addons.json';
const SKIPPED_GROUP = 'developer-tools';
const DEFAULT_ORG = 'abap2UI5-addons';

/** `catalog.ts` places every entry in a group; the org is abap2UI5-addons
 *  unless the entry says otherwise. Returns [{ repo, org, group }] in
 *  catalogue order. */
export function parseCatalog(ts) {
  const out = [];
  const groups = ts.split(/\bid:\s*"/).slice(1);
  for (const block of groups) {
    const group = block.slice(0, block.indexOf('"'));
    for (const [entry, repo] of block.matchAll(/\{\s*repo:\s*"([^"]+)"[^}]*\}/g)) {
      out.push({ repo, org: /\borg:\s*"([^"]+)"/.exec(entry)?.[1] ?? DEFAULT_ORG, group });
    }
  }
  return out;
}

/** The catalogue half of one snapshot record, from a record of the published
 *  projection or the same fields assembled from a checkout. */
export function catalogueFacts(record) {
  return {
    repo: record.repo,
    org: record.org,
    tagline: record.tagline ?? '',
    useWhen: record.useWhen ?? null,
    entryPoints: record.entryPoints ?? [],
    dependsOn: record.dependsOn ?? [],
  };
}

/** Which records the snapshot holds, from the catalogue's records in
 *  catalogue order: all outside developer-tools, then every dependency that
 *  is not among them (a catalogue entry of that group, or no entry at all). */
export function selectAddons(records) {
  const byKey = new Map(records.map((r) => [`${r.org}/${r.repo}`.toLowerCase(), r]));
  const taken = records.filter((r) => r.group !== SKIPPED_GROUP).map(catalogueFacts);
  const have = new Set(taken.map((a) => `${a.org}/${a.repo}`.toLowerCase()));
  for (const dep of taken.flatMap((a) => a.dependsOn)) {
    const key = dep.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    const known = byKey.get(key);
    const [org, repo] = dep.split('/');
    taken.push(known ? catalogueFacts(known) : { repo, org, tagline: '', useWhen: null, entryPoints: [], dependsOn: [] });
  }
  return taken;
}

/** The output of `git ls-remote --symref <url>`: the default branch, whether
 *  there is a `702` branch, and the release tags in the framework's numbering
 *  (`1.151.0`, `1.151.0-702`) - the only tags a pin is ever made of. */
export function parseRefs(text) {
  const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(text)?.[1] ?? null;
  const refs = text.split('\n').map((l) => l.split(/\s+/)[1]).filter(Boolean);
  const tags = refs.map((r) => /^refs\/tags\/(\d+\.\d+\.\d+(?:-702)?)$/.exec(r)?.[1]).filter(Boolean);
  const order = (t) => t.replace(/-702$/, '').split('.').map((n) => n.padStart(6, '0')).join('.') + (t.endsWith('-702') ? '~' : '');
  return {
    branch,
    branch702: refs.includes('refs/heads/702'),
    tags: [...new Set(tags)].sort((a, b) => order(a).localeCompare(order(b))),
  };
}

async function readCatalogue() {
  const catalog = path.join(SIBLING, 'src', 'data', 'catalog.ts');
  if (fs.existsSync(catalog)) {
    const records = parseCatalog(fs.readFileSync(catalog, 'utf8')).map((e) => {
      const facts = JSON.parse(fs.readFileSync(path.join(SIBLING, 'src', 'data', 'addons', `${e.repo}.json`), 'utf8'));
      return { ...facts, ...e };
    });
    if (!records.length) throw new Error(`${catalog} names no entry this can read - the catalogue changed shape`);
    return { records, from: 'the abap2ui5-addons.github.io checkout next to this one' };
  }
  const res = await fetch(PUBLISHED, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feed = await res.json();
  if (feed.schema !== 1 || !Array.isArray(feed.addons)) throw new Error(`${PUBLISHED} is not schema 1`);
  return { records: feed.addons, from: PUBLISHED };
}

function lsRemote(org, repo) {
  return execFileSync('git', ['ls-remote', '--symref', `https://github.com/${org}/${repo}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
  });
}

const serialise = (addons) => `${JSON.stringify({
  note: 'GENERATED by scripts/sync-addons.mjs in abap2UI5/app-template - do not edit. The addons `npm run add-addon -- <repo>` knows: what each is for and depends on (from the addon catalogue, https://abap2ui5-addons.github.io/addons.json) and what abaplint can clone it at (default branch, a 702 branch, the release tags - from each repository\'s refs).',
  addons,
}, null, 2)}\n`;

async function main() {
  const CHECK = process.argv.includes('--check');
  let catalogue;
  try {
    catalogue = await readCatalogue();
  } catch (err) {
    console.log(`sync-addons: the addon catalogue is not reachable (${err.message})`);
    console.log(CHECK ? 'SKIPPED: nothing was verified.' : 'SKIPPED: nothing was written.');
    return;
  }
  const previous = fs.existsSync(TARGET) ? JSON.parse(fs.readFileSync(TARGET, 'utf8')).addons : [];
  const before = new Map(previous.map((a) => [`${a.org}/${a.repo}`, a]));
  const wanted = selectAddons(catalogue.records);

  if (CHECK) {
    const strip = (a) => JSON.stringify(catalogueFacts(a));
    const now = wanted.map(strip);
    const had = previous.map(strip);
    if (JSON.stringify(now) === JSON.stringify(had)) {
      console.log(`sync-addons: scripts/addons.json matches the catalogue (${wanted.length} addons, read from ${catalogue.from}) - OK`);
      return;
    }
    const at = now.findIndex((r, i) => r !== had[i]);
    console.error('sync-addons: scripts/addons.json is out of date against the addon catalogue.');
    console.error(`  first difference at entry ${at + 1}\n    here:          ${had[at] ?? '<none>'}\n    the catalogue: ${now[at] ?? '<none>'}`);
    console.error(`\n  The catalogue was read from ${catalogue.from}.`);
    console.error('  Run `node scripts/sync-addons.mjs` to take it; a wrong fact is fixed in the catalogue.');
    process.exit(1);
  }

  const addons = [];
  for (const facts of wanted) {
    const key = `${facts.org}/${facts.repo}`;
    let git;
    try {
      git = parseRefs(lsRemote(facts.org, facts.repo));
      if (!git.branch) throw new Error('no default branch in the answer');
    } catch (err) {
      const kept = before.get(key);
      if (!kept) {
        console.error(`sync-addons: ${key}: its refs cannot be read (${String(err.message).split('\n')[0]}) and the snapshot has none to keep.`);
        console.error('  A default branch is not something to guess: run this again with network access.');
        process.exit(1);
      }
      console.log(`sync-addons: ${key}: refs not reachable - kept ${kept.branch}, ${kept.tags.length} tag(s) from the snapshot`);
      git = { branch: kept.branch, branch702: kept.branch702, tags: kept.tags };
    }
    addons.push({ ...facts, ...git });
  }
  const next = serialise(addons);
  if (fs.existsSync(TARGET) && fs.readFileSync(TARGET, 'utf8') === next) {
    console.log(`sync-addons: scripts/addons.json is current (${addons.length} addons, catalogue read from ${catalogue.from}) - OK`);
    return;
  }
  fs.writeFileSync(TARGET, next);
  console.log(`sync-addons: scripts/addons.json rewritten - ${addons.length} addons (catalogue read from ${catalogue.from})`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
