#!/usr/bin/env node
/*
 * generate-skills — the agent skills a project ships are MIRRORED from the
 * framework, the way the second half of AGENTS.md is.
 *
 * abap2UI5/abap2UI5 keeps four skills under `.claude/skills/` that an agent
 * loads on demand: `build-an-app` (the checklist for writing an app class),
 * `view-chain-layout` (the layout rules for a builder chain), `abap-check`
 * (the catalogue of ABAP problems a green CI does not catch) and `ui5-check`
 * (the same for the UI5 side). A project made from this template used to get
 * AGENTS.md alone - the guide, without the two catalogues and without the
 * skill that tells an agent when to read which.
 *
 * So this writes them into `.claude/skills/<name>/SKILL.md` here, and they
 * ship (they are in template.json's files.shared). Like generate-agents.mjs it
 * reads the framework checkout next to this one when there is one, and
 * raw.githubusercontent.com otherwise, and SAYS SO AND PASSES when neither is
 * reachable - a template whose CI goes red because github.com is unreachable
 * is a template people delete the check from.
 *
 *   node scripts/generate-skills.mjs           rewrite the four files
 *   node scripts/generate-skills.mjs --check   fail if a rewrite would change
 *                                              anything (this is what CI runs)
 *
 * A HANDFUL OF SENTENCES DEVIATE, declared below per skill as
 * `[what the framework says, what the project copy says]`. The skills are
 * written in the framework repository and point at files and npm scripts of
 * THAT repository: `docs/agents/building-apps.md` is the mirrored half of
 * AGENTS.md here, `npm run fmt:chains` is `npm run fix` here, and the run
 * order `npm run verify` heads is this project's `npm run check:all`. The two
 * catalogues also say "this repository" of the framework on nearly every
 * `Gate:` line; those are facts about where a gate lives and are not
 * rewritten - the generated header line says whose repository the text means.
 *
 * A deviation whose sentence is no longer in the skill FAILS rather than being
 * skipped, exactly as in scripts/app-guide-deviations.mjs: it means somebody
 * upstream edited a sentence this copy is known to reword, and the two have to
 * be reconciled by hand. Frontmatter (`name`, `description`) is copied as it
 * is upstream.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SIBLING = path.join(ROOT, '..', 'abap2UI5');
const RAW = 'https://raw.githubusercontent.com/abap2UI5/abap2UI5/main';
const sourcePath = (name) => `.claude/skills/${name}/SKILL.md`;

export const SKILL_DEVIATIONS = {
  'build-an-app': [
    /* The guide the skill sends the reader to is the mirrored half of this
     * project's AGENTS.md - there is no docs/ here. */
    [
      '**Read `docs/agents/building-apps.md` in this repository — it is the complete\nself-contained guide**',
      '**Read `AGENTS.md` in this repository — everything from "1. The model in one\nparagraph" down is the framework\'s complete self-contained guide**',
    ],
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
    /* The interface is in the framework repository, which abaplint clones
     * for the gate but which is not checked out here. */
    [
      '- The API contract is `src/02/z2ui5_if_client.intf.abap` — when unsure about',
      '- The API contract is `src/02/z2ui5_if_client.intf.abap` in\n  [abap2UI5/abap2UI5](https://github.com/abap2UI5/abap2UI5) — when unsure about',
    ],
  ],
  'view-chain-layout': [
    [
      'Run `npm run fmt:chains`. Do not re-indent by hand',
      'Run `npm run fix`. Do not re-indent by hand',
    ],
  ],
  'abap-check': [
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
  'ui5-check': [],
};
export const SKILLS = Object.keys(SKILL_DEVIATIONS);

/** The line after the frontmatter that says where the file came from. */
export function generatedLine(name) {
  return `<!-- GENERATED by scripts/generate-skills.mjs in abap2UI5/app-template from ${sourcePath(name)} `
    + 'in abap2UI5/abap2UI5 - "this repository" in the text is the framework\'s. Do not edit; regenerate. -->';
}

/** Frontmatter and body, split at the closing `---`. */
export function splitFrontmatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error('no frontmatter (--- name/description ---) at the top');
  return { frontmatter: m[0], body: text.slice(m[0].length) };
}

/** What the project copy of one skill has to be: the upstream text with its
 *  declared deviations applied and the provenance line inserted. Throws when
 *  a declared sentence is gone. */
export function renderSkill(name, upstream) {
  const { frontmatter, body } = splitFrontmatter(upstream);
  const rewritten = (SKILL_DEVIATIONS[name] || []).reduce((s, [from, to]) => {
    if (!s.includes(from)) {
      throw new Error(
        `${name}: declared deviation no longer matches the skill:\n      ${JSON.stringify(from)}\n`
        + '      the text it rewrites was edited or removed upstream — update SKILL_DEVIATIONS',
      );
    }
    return s.split(from).join(to);
  }, body);
  return `${frontmatter}${generatedLine(name)}\n${rewritten.replace(/\s*$/, '')}\n`;
}

async function readUpstream(name) {
  const sibling = path.join(SIBLING, sourcePath(name));
  if (fs.existsSync(sibling)) return { text: fs.readFileSync(sibling, 'utf8'), from: 'the abap2UI5 checkout next to this one' };
  const res = await fetch(`${RAW}/${sourcePath(name)}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), from: 'abap2UI5/main' };
}

function firstDifference(a, b) {
  const [x, y] = [a.split('\n'), b.split('\n')];
  const line = x.findIndex((l, i) => l !== y[i]);
  if (line === -1) return `same first ${Math.min(x.length, y.length)} line(s), then one version ends`;
  return `first difference at line ${line + 1}\n      here:     ${JSON.stringify(x[line] ?? '<end of file>')}\n      upstream: ${JSON.stringify(y[line] ?? '<end of file>')}`;
}

async function main() {
  let drifted = 0;
  let skipped = 0;
  let failed = 0;
  for (const name of SKILLS) {
    const target = path.join(ROOT, sourcePath(name));
    let upstream;
    try {
      upstream = await readUpstream(name);
    } catch (err) {
      console.log(`generate-skills: ${name}: upstream not reachable (${err.message}) - SKIPPED, nothing ${CHECK ? 'verified' : 'written'}`);
      skipped++;
      continue;
    }
    let next;
    try {
      next = renderSkill(name, upstream.text);
    } catch (err) {
      console.error(`generate-skills: ${err.message}\n      read from ${upstream.from}`);
      failed++;
      continue;
    }
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === next) {
      console.log(`generate-skills: ${sourcePath(name)} matches upstream (read from ${upstream.from}) - OK`);
      continue;
    }
    if (CHECK) {
      console.error(`generate-skills: ${sourcePath(name)} is ${current === null ? 'missing' : 'out of date'} (upstream read from ${upstream.from})`);
      if (current !== null) console.error(`      ${firstDifference(current, next)}`);
      drifted++;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
    console.log(`generate-skills: ${sourcePath(name)} ${current === null ? 'written' : 'rewritten'} (read from ${upstream.from})`);
  }
  if (failed || drifted) {
    if (drifted) {
      console.error('\n  Run `node scripts/generate-skills.mjs` to take the upstream text, or - if the change');
      console.error('  belongs in the skill - make it in abap2UI5 first. Editing a copy by hand is what');
      console.error('  the generator replaced.');
    }
    process.exit(1);
  }
  if (skipped === SKILLS.length) console.log(`generate-skills: SKIPPED - none of the ${SKILLS.length} skills was reachable.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
