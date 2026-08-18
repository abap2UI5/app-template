#!/usr/bin/env node
/*
 * generate-agents — the mirrored half of AGENTS.md is PRODUCED, not maintained.
 *
 * AGENTS.md is two documents in one file. Everything above
 * "## 1. The model in one paragraph" is this repository's own — what the files
 * are, how to run the gates, how `template.json` works. Everything from that
 * heading down is abap2UI5's app-building guide, `docs/agents/building-apps.md`,
 * carried here so a new project can brief an agent without a framework
 * checkout.
 *
 * That second half used to be a hand-kept transcription of 560 lines, and it
 * had drifted in BOTH directions within a fortnight of being written — the
 * dispatcher branches in the wrong order over here, a corpus count and a claim
 * about samples' baseline stale over there. The file said it was a mirror; a
 * paragraph asked people not to edit it; nothing checked either.
 *
 * abap2UI5 added a gate for it (`shared-file-gate.mjs`), which catches drift
 * after somebody has typed it. This closes the other half of the loop: the
 * mirror is now generated from the guide, so there is nothing to type.
 *
 *   node scripts/generate-agents.mjs           rewrite the mirrored half
 *   node scripts/generate-agents.mjs --check   fail if a rewrite would change
 *                                              anything (this is what CI runs)
 *
 * THREE SENTENCES DEVIATE, because the guide names commands and files that
 * exist in the framework repository and not in a project made from this
 * template. They are declared in `scripts/app-guide-deviations.mjs`, which is
 * not a file of this repository either: it is abap2UI5's
 * `.github/shared/app-guide-deviations.mjs`, copied here and gated byte-equal,
 * because abap2UI5's gate applies the same list to COMPARE while this applies
 * it to WRITE. Two transcriptions of one substitution list would put the drift
 * back, one level further down.
 *
 * So after a change here BOTH have to be green: this script's `--check`, and
 * abap2UI5's `npm run check:shared`. They are deliberately the same comparison
 * from the two sides — this one can be run by whoever edits the copy, that one
 * by whoever edits the guide, and neither has to remember the other exists.
 *
 * A deviation whose sentence is no longer in the guide FAILS rather than being
 * skipped: it means somebody upstream edited a sentence this repository is
 * known to reword, and the two have to be reconciled by hand.
 *
 * Where the guide is read from, in order:
 *   an abap2UI5 CHECKOUT next to this one    (offline, and what a local run sees)
 *   raw.githubusercontent.com/abap2UI5/abap2UI5/main
 * When neither is reachable the run SAYS SO and passes, writing nothing. This
 * file is copied into every repository made from this template, and a template
 * whose CI goes red because github.com is unreachable is a template people
 * delete the check from — the same rule `check-pin.mjs` states at more length.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGuideDeviations, guideBody, GUIDE_HEADING } from './app-guide-deviations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = path.join(ROOT, 'AGENTS.md');
const CHECK = process.argv.includes('--check');

const SOURCE = 'docs/agents/building-apps.md';
const SIBLING = path.join(ROOT, '..', 'abap2UI5', SOURCE);
const RAW = `https://raw.githubusercontent.com/abap2UI5/abap2UI5/main/${SOURCE}`;

let guide = null;
let from = '';
if (fs.existsSync(SIBLING)) {
  guide = fs.readFileSync(SIBLING, 'utf8');
  from = 'the abap2UI5 checkout next to this one';
} else {
  try {
    const res = await fetch(RAW, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    guide = await res.text();
    from = 'abap2UI5/main';
  } catch (err) {
    console.log(`generate-agents: the guide is not reachable (${err.message})`);
    console.log(CHECK ? 'SKIPPED: nothing was verified.' : 'SKIPPED: nothing was written.');
    process.exit(0);
  }
}

/* The two halves of this file, split at the heading the guide's mirrored part
 * begins with. Anything above it is this repository's own and is copied
 * through untouched — including the provenance block, which is what tells a
 * reader of a generated project where the rest came from. */
const current = fs.readFileSync(AGENTS, 'utf8');
const at = current.search(/^## 1\. The model in one paragraph$/m);
if (at === -1) {
  console.error(`generate-agents: AGENTS.md has no "${GUIDE_HEADING}" heading on a line of its own.`);
  console.error('  That heading is where this repository\'s own half ends and the mirror begins;');
  console.error('  without it there is no way to tell which part may be rewritten.');
  process.exit(1);
}
const own = current.slice(0, at);

let mirrored;
try {
  mirrored = applyGuideDeviations(guideBody(guide));
} catch (err) {
  console.error(`generate-agents: ${err.message}`);
  console.error(`  read from ${from}`);
  console.error('  see scripts/app-guide-deviations.mjs — and note that it is a SHARED file:');
  console.error('  change abap2UI5\'s .github/shared/app-guide-deviations.mjs and copy it here.');
  process.exit(1);
}

/* One trailing newline, whatever the guide ends with: the guide is a page of a
 * documentation site and this is a repository's AGENTS.md, and a difference of
 * blank lines at the very end is not a difference either of them means. */
const next = `${own}${mirrored.replace(/\s*$/, '')}\n`;

if (next === current) {
  console.log(`generate-agents: the mirrored half matches the guide (read from ${from}) - OK`);
  process.exit(0);
}

if (!CHECK) {
  fs.writeFileSync(AGENTS, next);
  console.log(`generate-agents: AGENTS.md rewritten from ${SOURCE} (read from ${from})`);
  process.exit(0);
}

/* Naming the first differing line is the difference between a report somebody
 * acts on and one somebody closes. Counted from the top of AGENTS.md, because
 * that is the file a reader has open. */
const a = current.split('\n');
const b = next.split('\n');
const line = a.findIndex((l, i) => l !== b[i]);
console.error('generate-agents: the mirrored half of AGENTS.md is out of date.');
console.error(line === -1
  ? `  same first ${Math.min(a.length, b.length)} line(s), then one version ends`
  : `  first difference at AGENTS.md line ${line + 1}\n`
    + `    here:      ${JSON.stringify(a[line] ?? '<end of file>')}\n`
    + `    the guide: ${JSON.stringify(b[line] ?? '<end of file>')}`);
console.error(`\n  The guide is abap2UI5's ${SOURCE} (read from ${from}).`);
console.error('  Run `npm run agents` to take it, or - if the change belongs in the guide -');
console.error('  make it there first. Editing the mirrored half by hand is what this replaced.');
process.exit(1);
