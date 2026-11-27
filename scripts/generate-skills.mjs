#!/usr/bin/env node
/*
 * generate-skills — the agent skills a project ships are MIRRORED from the
 * framework, the way the guide and its essentials in AGENTS.md are.
 *
 * abap2UI5/abap2UI5 keeps four skills an agent loads on demand: `build-an-app`
 * (the checklist for writing an app class), `view-chain-layout` (the layout
 * rules for a builder chain), `abap-check` (the catalogue of ABAP problems a
 * green CI does not catch) and `ui5-check` (the same for the UI5 side).
 *
 * WHICH FORM. The framework writes them twice: whole, under `.claude/skills/`
 * (abap-check is one file of 150 KB there), and SPLIT, under `skills/` - its
 * `npm run plugin` cuts every long section of a catalogue into a file under
 * `references/` and leaves a short `SKILL.md` with a table saying which file
 * to read when. A skill is loaded whole, so the first form made an agent pay
 * for the downport traps of the framework's own pipeline to read three pages
 * about the abapGit round trip. This mirrors the SPLIT form:
 *
 *   .claude/skills/<name>/SKILL.md               from skills/<name>/SKILL.md
 *   .claude/skills/<name>/references/<file>.md   from skills/<name>/references/
 *
 * One reference is not written here: `build-an-app/references/building-apps.md`
 * is the app-building guide, and scripts/generate-agents.mjs writes it from
 * the guide's source with the guide's declared deviations (GUIDE_REFERENCE
 * below). There is one copy of the guide in a project, and that is it.
 *
 * WHICH FILES is read off each SKILL.md: the `references/<file>.md` it names.
 * With a framework checkout next to this one the folder is compared too, so a
 * reference no SKILL.md names, or a named one that is not there, fails
 * instead of shipping half a catalogue. A reference here that upstream no
 * longer has is deleted.
 *
 * template.json FOLLOWS. Every file under .claude/skills/ is in its
 * `files.shared` and `agentSetup.files` one by one (the MCP server and the
 * create package copy by that list), and the list of references is the
 * framework's to change - so a write run rewrites those entries from what it
 * wrote, and `--check` fails when they disagree.
 *
 * Like generate-agents.mjs it reads the framework checkout next to this one
 * when there is one, and raw.githubusercontent.com otherwise - and says which
 * - and SAYS SO AND PASSES when neither is reachable on a developer's machine:
 * a template whose check goes red because github.com is unreachable is a
 * template people delete the check from. Under CI (the CI environment
 * variable) `--check` FAILS instead: there a SKIPPED is a gate that checked
 * nothing and stayed green. GENERATE_SKILLS_UPSTREAM replaces the raw URL
 * (the tests point it at a host that does not answer).
 *
 *   node scripts/generate-skills.mjs           rewrite the files
 *   node scripts/generate-skills.mjs --check   fail if a rewrite would change
 *                                              anything (this is what CI runs)
 *
 * A HANDFUL OF SENTENCES DEVIATE, declared below per file as
 * `[what the framework says, what the project copy says]`. The skills are
 * written in the framework repository and point at npm scripts of THAT
 * repository: `npm run fmt:chains` is `npm run fix` here, and the run order
 * `npm run verify` heads is this project's `npm run check:all`. The two
 * catalogues also say "this repository" of the framework on nearly every
 * `Gate:` line; those are facts about where a gate lives and are not
 * rewritten - the generated header line says whose repository the text means.
 *
 * A deviation whose sentence is no longer in the file FAILS rather than being
 * skipped, exactly as in scripts/app-guide-deviations.mjs: it means somebody
 * upstream edited a sentence this copy is known to reword, and the two have to
 * be reconciled by hand. Frontmatter is copied as it is upstream.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SIBLING = path.join(ROOT, '..', 'abap2UI5');
const RAW = process.env.GENERATE_SKILLS_UPSTREAM || 'https://raw.githubusercontent.com/abap2UI5/abap2UI5/main';
/** CI: a --check that could not read upstream fails rather than passing. */
const STRICT = CHECK && Boolean(process.env.CI) && process.env.CI !== 'false';
const TARGET = '.claude/skills';
const UPSTREAM = 'skills';
const SPEC = 'template.json';

export const SKILLS = ['build-an-app', 'view-chain-layout', 'abap-check', 'ui5-check'];

/* The guide: under this skill, written by generate-agents.mjs. */
export const GUIDE_REFERENCE = 'build-an-app/references/building-apps.md';

/* Keyed by the file under .claude/skills/. */
export const SKILL_DEVIATIONS = {
  'build-an-app/SKILL.md': [
    /* Same command, under the name the template gives it. */
    [
      '`npm run check:abap2ui5` reports,\n  `npm run fmt:chains` applies)',
      '`npm run check:abap2ui5` reports,\n  `npm run fix` applies)',
    ],
    /* The linter is a devDependency of the project, with a config. */
    [
      '- Validate with the abap2UI5-linter\n  (`npx --yes @abap2ui5/linter <file>`); iterate without a SAP',
      '- Validate with the abap2UI5-linter\n  (`npm run check:abap2ui5`, or `npm run check:abap2ui5:fast` without the\n  render gate); iterate without a SAP',
    ],
  ],
  'view-chain-layout/SKILL.md': [
    [
      'Run `npm run fmt:chains`. Do not re-indent by hand',
      'Run `npm run fix`. Do not re-indent by hand',
    ],
  ],
  'abap-check/SKILL.md': [
    /* The scope note has to say whose commands the catalogue quotes. */
    [
      'The commands quoted below are this\n> repository\'s; the rules behind them are not.',
      'The commands quoted below are the\n> framework repository\'s (abap2UI5/abap2UI5); the rules behind them are not.',
    ],
    /* The framework's run order, in this project's scripts. */
    [
      '```\nnpm run check           # abaplint (fast inner loop)\n'
      + 'npm run check:abapgit   # the abapGit round trip - covers src/00 and src/99 too\n'
      + 'npm run check:atc       # the extended-check traps a script can decide\n'
      + 'npm run check_visibility\n'
      + 'npm run verify          # before any PR; includes all of the above\n```',
      '```\nnpm run check:abap            # abaplint (fast inner loop)\n'
      + 'npm run check:abap2ui5:fast   # the abap2UI5-linter without the render gate\n'
      + 'npm run doctor                # the sidecars (BOM, LF, CLSNAME), the pins, the browser\n'
      + 'npm run check:all             # before any PR: the pin, abaplint, the linter with its render gate\n```',
    ],
  ],
};

/* Why an existing project gets each file - template.json's agentSetup.files
 * wants a reason per entry, and these are generated with the entries. */
const SKILL_REASON = {
  'build-an-app': 'the checklist for writing an app class, loaded on demand',
  'view-chain-layout': 'the layout rules for a builder chain and the linter rule that checks them',
  'abap-check': 'the ABAP a green CI does not catch - abapGit round trip, activation, runtime: the short index, its long sections are the references next to it',
  'ui5-check': 'the UI5 a green CI does not catch - names the oldest supported release does not have: the short index, its long sections are the references next to it',
};
const GUIDE_REASON = 'the framework\'s app-building guide, whole - the ONE copy in a project. AGENTS.md carries its essentials and says which section to read when; the build-an-app skill points here';
const referenceReason = (rel) => `a section of the ${rel.split('/')[0]} skill, read when the table in its SKILL.md says so - a skill is loaded whole, its references one at a time`;

/** The line that says where a file came from. */
export function generatedLine(rel) {
  return `<!-- GENERATED by scripts/generate-skills.mjs in abap2UI5/app-template from ${UPSTREAM}/${rel} `
    + 'in abap2UI5/abap2UI5 - "this repository" in the text is the framework\'s. Do not edit; regenerate. -->';
}

/* The line the framework's own generator put there, which this one replaces. */
const UPSTREAM_LINE = /^<!-- GENERATED by \.github\/scripts\/generate-plugin\.mjs [^\n]*-->\n/m;

/** Frontmatter and body, split at the closing `---`; no frontmatter, no split. */
export function splitFrontmatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return m ? { frontmatter: m[0], body: text.slice(m[0].length) } : { frontmatter: '', body: text };
}

/** The reference files a SKILL.md names, sorted. */
export function referencesOf(skillText) {
  return [...new Set([...skillText.matchAll(/\breferences\/([A-Za-z0-9._-]+\.md)\b/g)].map((m) => m[1]))].sort();
}

/** What the project copy of one file has to be: the upstream text with its
 *  declared deviations applied and the provenance line in place of the
 *  framework generator's. Throws when a declared sentence is gone, and for a
 *  SKILL.md without frontmatter. */
export function renderFile(rel, upstream) {
  const { frontmatter, body } = splitFrontmatter(upstream);
  if (rel.endsWith('/SKILL.md') && !frontmatter) throw new Error(`${rel}: no frontmatter (--- name/description ---) at the top`);
  const rewritten = (SKILL_DEVIATIONS[rel] || []).reduce((s, [from, to]) => {
    if (!s.includes(from)) {
      throw new Error(
        `${rel}: declared deviation no longer matches the skill:\n      ${JSON.stringify(from)}\n`
        + '      the text it rewrites was edited or removed upstream — update SKILL_DEVIATIONS',
      );
    }
    return s.split(from).join(to);
  }, body.replace(UPSTREAM_LINE, '').replace(/^\s+/, ''));
  return `${frontmatter}${generatedLine(rel)}\n\n${rewritten.replace(/\s*$/, '')}\n`;
}

/** template.json's two lists with the entries under .claude/skills/ replaced
 *  by `files` (paths relative to the repository), everything else untouched
 *  and in place. Returns the new text. */
export function syncSpec(specText, files) {
  const spec = JSON.parse(specText);
  const isSkill = (f) => f.startsWith(`${TARGET}/`);
  const reason = (f) => {
    const rel = f.slice(TARGET.length + 1);
    if (rel === GUIDE_REFERENCE) return GUIDE_REASON;
    if (rel.endsWith('/SKILL.md')) return SKILL_REASON[rel.split('/')[0]];
    return referenceReason(rel);
  };
  const at = spec.files.shared.findIndex(isSkill);
  const rest = spec.files.shared.filter((f) => !isSkill(f));
  rest.splice(at === -1 ? rest.length : at, 0, ...files);
  spec.files.shared = rest;

  const entries = Object.entries(spec.agentSetup.files);
  const first = entries.findIndex(([f]) => isSkill(f));
  const kept = entries.filter(([f]) => !isSkill(f));
  kept.splice(first === -1 ? kept.length : first, 0, ...files.map((f) => [f, reason(f)]));
  spec.agentSetup.files = Object.fromEntries(kept);
  return `${JSON.stringify(spec, null, 2)}\n`;
}

const sibling = fs.existsSync(path.join(SIBLING, UPSTREAM));

async function readUpstream(rel) {
  if (sibling) {
    const file = path.join(SIBLING, UPSTREAM, rel);
    if (!fs.existsSync(file)) throw new Error(`not in the checkout: ${UPSTREAM}/${rel}`);
    return fs.readFileSync(file, 'utf8');
  }
  const res = await fetch(`${RAW}/${UPSTREAM}/${rel}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function firstDifference(a, b) {
  const [x, y] = [a.split('\n'), b.split('\n')];
  const line = x.findIndex((l, i) => l !== y[i]);
  if (line === -1) return `same first ${Math.min(x.length, y.length)} line(s), then one version ends`;
  return `first difference at line ${line + 1}\n      here:     ${JSON.stringify(x[line] ?? '<end of file>')}\n      upstream: ${JSON.stringify(y[line] ?? '<end of file>')}`;
}

async function main() {
  const from = sibling ? `the sibling checkout ${SIBLING}` : `upstream ${RAW}`;
  console.log(`generate-skills: reading the framework's ${UPSTREAM}/ from ${from}`);
  let drifted = 0;
  let skipped = 0;
  let failed = 0;
  const wanted = new Map(); // path under .claude/skills/ -> text, null for the guide

  for (const name of SKILLS) {
    let skill;
    try {
      skill = await readUpstream(`${name}/SKILL.md`);
    } catch (err) {
      /* With a checkout there, a missing skill is not "unreachable": the
       * framework no longer has it, and that is a decision. */
      if (sibling) {
        console.error(`generate-skills: ${name}: ${err.message} - the framework no longer ships this skill in ${UPSTREAM}/`);
        failed++;
      } else {
        console.log(`generate-skills: ${name}: upstream not reachable (${err.message}) - SKIPPED, nothing ${CHECK ? 'verified' : 'written'}`);
        skipped++;
      }
      continue;
    }
    const refs = referencesOf(skill);
    if (sibling) {
      const dir = path.join(SIBLING, UPSTREAM, name, 'references');
      const there = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
      const unnamed = there.filter((f) => !refs.includes(f));
      if (unnamed.length) {
        console.error(`generate-skills: ${name}: ${UPSTREAM}/${name}/references/ holds ${unnamed.join(', ')}, which its SKILL.md does not name - this reads the list off SKILL.md and would not ship ${unnamed.length === 1 ? 'it' : 'them'}`);
        failed++;
      }
    }
    try {
      wanted.set(`${name}/SKILL.md`, renderFile(`${name}/SKILL.md`, skill));
      for (const ref of refs) {
        const rel = `${name}/references/${ref}`;
        if (rel === GUIDE_REFERENCE) {
          wanted.set(rel, null);
          continue;
        }
        wanted.set(rel, renderFile(rel, await readUpstream(rel)));
      }
    } catch (err) {
      console.error(`generate-skills: ${err.message}\n      read from ${from}`);
      failed++;
    }
  }

  if (skipped && STRICT) {
    console.error(`generate-skills: ${skipped} of ${SKILLS.length} skills could not be read from ${from} - under CI --check fails `
      + 'rather than pass having verified nothing (clone abap2UI5 next to this checkout, or let the job reach github.com)');
    process.exit(1);
  }
  if (skipped === SKILLS.length) {
    console.log(`generate-skills: SKIPPED - none of the ${SKILLS.length} skills was reachable.`);
    return;
  }
  if (!wanted.has(GUIDE_REFERENCE) && !failed && !skipped) {
    console.error(`generate-skills: build-an-app/SKILL.md no longer names references/building-apps.md - the guide (${TARGET}/${GUIDE_REFERENCE}, written by generate-agents.mjs) would be a file nothing points at`);
    failed++;
  }

  for (const [rel, next] of wanted) {
    if (next === null) continue;
    const target = path.join(ROOT, TARGET, rel);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === next) continue;
    if (CHECK) {
      console.error(`generate-skills: ${TARGET}/${rel} is ${current === null ? 'missing' : 'out of date'} (upstream read from ${from})`);
      if (current !== null) console.error(`      ${firstDifference(current, next)}`);
      drifted++;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
    console.log(`generate-skills: ${TARGET}/${rel} ${current === null ? 'written' : 'rewritten'}`);
  }

  /* What is here and upstream is not: only judged when every skill was read. */
  if (!skipped && !failed) {
    for (const name of fs.existsSync(path.join(ROOT, TARGET)) ? fs.readdirSync(path.join(ROOT, TARGET)) : []) {
      const dir = path.join(ROOT, TARGET, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir, { recursive: true }).map((x) => String(x).split(path.sep).join('/'))) {
        if (fs.statSync(path.join(dir, f)).isDirectory() || wanted.has(`${name}/${f}`)) continue;
        if (CHECK) {
          console.error(`generate-skills: ${TARGET}/${name}/${f} is here and not upstream - a regeneration removes it`);
          drifted++;
        } else {
          fs.rmSync(path.join(dir, f));
          console.log(`generate-skills: ${TARGET}/${name}/${f} removed - upstream no longer has it`);
        }
      }
    }
    const files = [...wanted.keys()].map((rel) => `${TARGET}/${rel}`);
    const specNow = fs.readFileSync(path.join(ROOT, SPEC), 'utf8');
    const specNext = syncSpec(specNow, files);
    if (specNext !== specNow) {
      if (CHECK) {
        console.error(`generate-skills: ${SPEC} does not list the files under ${TARGET}/ as they are - files.shared and agentSetup.files name them one by one`);
        drifted++;
      } else {
        fs.writeFileSync(path.join(ROOT, SPEC), specNext);
        console.log(`generate-skills: ${SPEC} rewritten - files.shared and agentSetup.files list the ${files.length} files under ${TARGET}/`);
      }
    }
  }

  if (failed || drifted) {
    if (drifted) {
      console.error('\n  Run `node scripts/generate-skills.mjs` to take the upstream text, or - if the change');
      console.error('  belongs in the skill - make it in abap2UI5 first. Editing a copy by hand is what');
      console.error('  the generator replaced.');
    }
    process.exit(1);
  }
  if (!skipped) console.log(`generate-skills: ${wanted.size - 1} files of ${SKILLS.length} skills under ${TARGET}/ match upstream (read from ${from}) - OK`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
