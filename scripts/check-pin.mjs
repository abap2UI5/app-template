#!/usr/bin/env node
/*
 * check-pin — the framework release this repository names has to be ONE
 * number, and it should be a number that still exists.
 *
 * `abaplint.jsonc` pins the abap2UI5 framework with the `"branch"` key,
 * because that is the only key abaplint has and it takes a tag as happily as
 * a branch name. The consequence nobody sees coming: **nothing can move that
 * pin for you**. Dependabot understands `package.json`, not a tag name inside
 * an abaplint dependency, and the same release number is written out again in
 * two pieces of prose (README, AGENTS.md) that no tool reads at all. So the
 * pin ages, the prose ages differently, and the first symptom is a reader who
 * installs the release the README names and gets a lint error the pin does
 * not have.
 *
 * Two halves, and only one of them can fail the run:
 *
 *   the three places must agree with EACH OTHER. That is a fact about this
 *   repository, checkable offline, and disagreeing is simply wrong - it fails.
 *
 *   whether the pin is the NEWEST framework release is a notice, never a
 *   failure. Bumping it is a decision (a newer release can carry an API the
 *   starter class does not use yet, and the point of a pin is that it does not
 *   move by itself), and this file is copied into every repository made from
 *   this template - a template that turns every downstream CI red on the day
 *   abap2UI5 publishes would be a template people delete this check from.
 *
 * When GitHub is unreachable - offline, rate limit, a sandbox with no route -
 * the three places are still checked against each other and the run SAYS the
 * outside half did not happen. A gate must not go red because github.com is
 * down, and it must not claim to have verified something it did not.
 *
 *   node scripts/check-pin.mjs        (npm run check:pin)
 *
 * Moving the pin: change all three places to the new tag, then `npm run check`
 * - if the starter class needs an API the release does not have, that is what
 * tells you, which is the whole point of having a pin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const API = 'https://api.github.com/repos/abap2UI5/abap2UI5/releases/latest';

/* The framework publishes each release twice: `1.143.0` and, minutes later,
 * `1.143.0-702` - the same code downported for NetWeaver 7.02, shipped as its
 * own repository. `releases/latest` therefore answers `-702` for most of the
 * time after a release, and it is not a different version. */
const versionOf = (tag) => tag.replace(/-\w+$/, '');

/** Where the release number is written, and how to find it in each file.
 *
 * `optional` marks a place that exists in the TEMPLATE and legitimately does
 * not exist in a project made from it. This file ships, so it runs in both:
 * a project writes its own README (template.json excludes ours), and failing
 * there would hand every new project a red gate on its first push. A file that
 * IS present still has to agree - only its absence is forgiven. */
const SITES = [
  {
    file: 'abaplint.jsonc',
    what: 'the pin abaplint clones the framework at',
    re: /"branch":\s*"(\d+\.\d+\.\d+)"/,
  },
  {
    file: 'README.md',
    what: 'the release the quick start tells you to install',
    re: /needs framework \*\*(\d+\.\d+\.\d+) or newer\*\*/,
    optional: true,
  },
  {
    file: 'AGENTS.md',
    what: 'the pin named in the repository table',
    re: /pinned to release tag `(\d+\.\d+\.\d+)`/,
  },
];

const problems = [];
const found = [];

for (const site of SITES) {
  const full = path.join(ROOT, site.file);
  if (!fs.existsSync(full)) {
    if (site.optional) continue;
    problems.push(`${site.file}: gone - this gate names it as one of the places the release is written`);
    continue;
  }
  const m = site.re.exec(fs.readFileSync(full, 'utf8'));
  if (!m) {
    problems.push(
      `${site.file}: no release number found where ${site.what} should be\n`
      + '    the file changed shape - fix the pattern in scripts/check-pin.mjs,\n'
      + '    or this gate silently stops checking that place',
    );
    continue;
  }
  found.push({ ...site, version: m[1] });
}

const distinct = [...new Set(found.map((f) => f.version))];
if (!found.length) {
  problems.push('no file names a framework release at all - with every place optional or reshaped '
    + 'this gate would pass by checking nothing');
}
if (distinct.length > 1) {
  problems.push(
    `the three places disagree: ${distinct.join(' / ')}\n`
    + found.map((f) => `      ${f.version}  ${f.file} (${f.what})`).join('\n'),
  );
}

/* The half that needs the network. */
let latest = null;
let why = '';
try {
  const res = await fetch(API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'abap2ui5-app-template-check-pin' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  latest = versionOf((await res.json()).tag_name);
} catch (err) {
  why = err.message;
}

console.log(`check-pin: ${found.length} place(s) name the framework release`);
for (const f of found) console.log(`  ${f.version}  ${f.file} - ${f.what}`);

if (!latest) {
  console.log(
    `could NOT reach the release API (${why}) - the places were checked against\n`
    + '  each other only. Whether the pin is the newest release is UNVERIFIED.',
  );
} else if (distinct.length === 1 && distinct[0] !== latest) {
  const note = `abap2UI5 ${latest} is out; this repository pins ${distinct[0]}. `
    + 'Bump the three places together and run `npm run check` - a release you cannot compile against is what the pin exists to show you.';
  console.log(`newest release of abap2UI5/abap2UI5: ${latest}`);
  /* Two audiences, one fact. For somebody who STARTED a project from this
   * template, a newer framework release is news, not a defect - their build
   * must not go red because another repository published something. So the
   * default stays a notice.
   *
   * For whoever maintains the template it is the whole point of the pin, and a
   * notice on a pull request nobody opened that week is a notice nobody reads.
   * --strict is how the scheduled freshness run opts into failing, so a stale
   * pin becomes an issue with a name on it instead of a line in a log. */
  if (STRICT) problems.push(note);
  else if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Framework pin::${note}`);
  else console.log(`  note: ${note}`);
} else {
  console.log(`newest release of abap2UI5/abap2UI5: ${latest} - the pin is current`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nThe release number lives in three hand-maintained places and no tool moves it.');
  console.error('Change them together - and read the prose around them: a sentence like');
  console.error('"1.142.0 has neither ..." goes stale with the number.');
  process.exit(1);
}
console.log('the repository names one framework release, everywhere - OK');
