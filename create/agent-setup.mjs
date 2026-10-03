/*
 * agent-setup — `npm create abap2ui5-app@latest -- --agent-setup [dir]`
 *
 * The other mode of create-abap2ui5-app, for the project that already exists.
 * Most abap2UI5 projects never started from abap2UI5/app-template - they are
 * an abapGit repository with a src/ folder - and the template's agent setup
 * (AGENTS.md, the four skills, the MCP server, the permission allowlist) is
 * worth as much there. So this adds THAT part of the template, and the two
 * gates and the CI job the setup tells an agent to run, to a directory that
 * already has a project in it.
 *
 * Which files that is, which of them are merged rather than copied, and which
 * text in them names the source folder: all of it is `template.json`'s
 * `agentSetup` key, read at run time like everything else this package does.
 * This file carries the three rules that make writing into somebody's
 * repository safe, and nothing else:
 *
 *   a file the project has is NEVER overwritten. It is skipped, and named, so
 *   "your AGENTS.md was left as it is" is a line in the output and not a
 *   surprise later. To take the template's version, delete yours and re-run;
 *   a second run over a finished setup changes nothing.
 *
 *   the two files under `agentSetup.merge` (package.json, .gitignore) only ever
 *   GAIN entries. A script, devDependency or pattern the project already has
 *   keeps its value, whatever the template says - and every one kept on a
 *   different value is named.
 *
 *   src/ is the template's folder, not necessarily the project's. abapGit's
 *   `.abapgit.xml` says where the project keeps its classes (STARTING_FOLDER),
 *   and the files `agentSetup.sourceFolder` names are pointed there - a gate
 *   checking a src/ that is not there checks nothing, and passes.
 *
 * `planAgentSetup` decides everything without writing anything, so a template
 * file that fails to fetch leaves the project untouched and the tests can look
 * at the plan. The pure pieces are exported for those tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** `<STARTING_FOLDER>/abap/src/</STARTING_FOLDER>` -> `abap/src`; '' for the
 *  repository root; null when the file says nothing. */
export function startingFolder(abapgitXml) {
  const m = /<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/.exec(abapgitXml || '');
  if (!m) return null;
  return m[1].trim().replace(/^\/+|\/+$/g, '');
}

/** One file's text with the template's source folder replaced by the
 *  project's, at the places `agentSetup.sourceFolder` names - inside the first
 *  occurrence of each `text` only. Unchanged when the folder is the
 *  template's own, or when no edit names the file. */
export function adaptSourceFolder(rel, text, sourceFolder, folder) {
  if (!sourceFolder || folder === sourceFolder.placeholder) return text;
  let out = text;
  for (const edit of sourceFolder.edits) {
    if (edit.file !== rel) continue;
    const at = out.indexOf(edit.text);
    if (at === -1) continue;
    const replaced = edit.text.replace(sourceFolder.placeholder, folder);
    out = out.slice(0, at) + replaced + out.slice(at + edit.text.length);
  }
  return out;
}

/** The indentation a JSON file is written with, so a merge does not reformat
 *  somebody's package.json from four spaces to two. */
function indentOf(text) {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
}

/**
 * package.json, merged: every entry under `keys` the project lacks is added,
 * every entry it has keeps its value. Returns the new text (null when nothing
 * was added), what was added, and what was kept on a value that differs from
 * the template's. Throws when the project's package.json is not JSON - the
 * caller refuses before writing anything.
 */
export function mergePackageJson(existingText, templateText, keys) {
  const tpl = JSON.parse(templateText);
  const pkg = JSON.parse(existingText);
  const added = [];
  const kept = [];
  for (const key of keys) {
    const want = tpl[key];
    if (!want || typeof want !== 'object') continue;
    for (const [name, value] of Object.entries(want)) {
      // a gate the project already depends on at runtime is a gate it has
      const have = pkg[key]?.[name] ?? (key === 'devDependencies' ? pkg.dependencies?.[name] : undefined);
      if (have === undefined) {
        pkg[key] = { ...(pkg[key] || {}), [name]: value };
        added.push(`${key}.${name}`);
      } else if (have !== value) {
        kept.push({ entry: `${key}.${name}`, have, want: value });
      }
    }
  }
  if (!added.length) return { text: null, added, kept };
  const eol = existingText.endsWith('\n') || !existingText.length ? '\n' : '';
  return { text: JSON.stringify(pkg, null, indentOf(existingText)) + eol, added, kept };
}

/** `node_modules`, `/node_modules`, `node_modules/` - one pattern to a reader,
 *  three strings to a Set. */
const normalisePattern = (line) => line.trim().replace(/^\/+|\/+$/g, '');

/**
 * .gitignore, merged: the template's patterns the project does not ignore yet
 * are appended, each block with the comment lines above it in the template.
 * Returns the new text (null when nothing was missing) and the patterns added.
 */
export function mergeLines(existingText, templateText) {
  const have = new Set(existingText.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).map(normalisePattern));
  const out = [];
  const added = [];
  let comments = [];
  let fresh = true; // the next pattern starts a block: a blank line above it, as in the template
  for (const line of templateText.split(/\r?\n/)) {
    if (!line.trim()) {
      comments = [];
      fresh = true;
      continue;
    }
    if (line.trim().startsWith('#')) {
      comments.push(line);
      continue;
    }
    if (have.has(normalisePattern(line))) continue;
    if (fresh && out.length) out.push('');
    out.push(...comments, line);
    comments = [];
    fresh = false;
    added.push(line.trim());
  }
  if (!added.length) return { text: null, added };
  let text = existingText;
  if (text.length && !text.endsWith('\n')) text += '\n';
  if (text.length) text += '\n';
  return { text: `${text}${out.join('\n')}\n`, added };
}

/** The npm package name a project without a package.json gets: the
 *  directory's, in the characters npm accepts. */
export function packageNameFor(dir) {
  return path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || 'abap2ui5-app';
}

/** Where the project's classes are, and how that was decided. */
export function sourceFolderOf(dir, placeholder) {
  const xmlPath = path.join(dir, '.abapgit.xml');
  if (!fs.existsSync(xmlPath)) {
    return { folder: placeholder, from: `no .abapgit.xml - assuming ${placeholder}/` };
  }
  const folder = startingFolder(fs.readFileSync(xmlPath, 'utf8'));
  if (folder === null) return { folder: placeholder, from: `.abapgit.xml names no STARTING_FOLDER - assuming ${placeholder}/` };
  return { folder, from: '.abapgit.xml STARTING_FOLDER' };
}

/**
 * The whole agent setup for `dir`, decided and not written: one action per
 * file - `add` (bytes to write), `merge` (bytes to write over the project's,
 * with what was added), `skip` (the project has it, or has everything the
 * merge would add) - plus the warnings to print.
 */
export async function planAgentSetup(spec, read, dir) {
  const setup = spec.agentSetup;
  const placeholder = setup.sourceFolder?.placeholder ?? 'src';
  const warnings = [];
  let { folder, from } = sourceFolderOf(dir, placeholder);
  if (folder === '') {
    warnings.push(`.abapgit.xml's STARTING_FOLDER is the repository root - the gates were left pointing at ${placeholder}/; `
      + `set abaplint.jsonc's global.files and abap2ui5lint.jsonc's paths to your classes by hand`);
    folder = placeholder;
  }
  if (!fs.existsSync(path.join(dir, folder))) {
    warnings.push(`${folder}/ does not exist - the gates are configured for it and will find no classes there`);
  }

  const actions = [];
  for (const rel of Object.keys(setup.files)) {
    const target = path.join(dir, rel);
    const exists = fs.existsSync(target);
    const merge = setup.merge?.[rel];
    if (exists && !merge) {
      actions.push({ path: rel, kind: 'skip', detail: 'already there - left as it is' });
      continue;
    }
    const bytes = await read(rel);
    const adapted = adaptSourceFolder(rel, bytes.toString('utf8'), setup.sourceFolder, folder);
    const changed = adapted !== bytes.toString('utf8');
    const folderNote = changed ? `sources: ${folder}/` : '';

    if (!exists && merge?.how === 'json') {
      // A project without a package.json gets the entries a merge would add,
      // under its own name - not the template's file, whose license and
      // description are the template's to declare, not this project's.
      const base = `${JSON.stringify({ name: packageNameFor(dir), private: true }, null, 2)}\n`;
      const result = mergePackageJson(base, adapted, merge.keys);
      actions.push({ path: rel, kind: 'add', bytes: Buffer.from(result.text ?? base, 'utf8'), detail: folderNote });
      continue;
    }
    if (!exists) {
      const out = changed ? Buffer.from(adapted, 'utf8') : bytes;
      actions.push({ path: rel, kind: 'add', bytes: out, detail: folderNote });
      continue;
    }

    const existing = fs.readFileSync(target, 'utf8');
    if (merge.how === 'json') {
      let result;
      try {
        result = mergePackageJson(existing, adapted, merge.keys);
      } catch (err) {
        throw new Error(`${rel} is not valid JSON (${err.message}) - fix it, or move it aside and re-run`);
      }
      for (const k of result.kept) {
        warnings.push(`${rel}: kept your ${k.entry} ${JSON.stringify(k.have)} - the template has ${JSON.stringify(k.want)}`);
      }
      if (!result.text) {
        actions.push({ path: rel, kind: 'skip', detail: `already has every entry of ${merge.keys.join(', ')}` });
      } else {
        const counts = merge.keys
          .map((key) => [key, result.added.filter((a) => a.startsWith(`${key}.`)).length])
          .filter(([, n]) => n)
          .map(([key, n]) => `+${n} ${key}`);
        actions.push({ path: rel, kind: 'merge', bytes: Buffer.from(result.text, 'utf8'), detail: counts.join(', '), added: result.added });
      }
    } else if (merge.how === 'lines') {
      const result = mergeLines(existing, adapted);
      if (!result.text) actions.push({ path: rel, kind: 'skip', detail: 'already ignores everything the template does' });
      else actions.push({ path: rel, kind: 'merge', bytes: Buffer.from(result.text, 'utf8'), detail: `+ ${result.added.join(' ')}`, added: result.added });
    } else {
      throw new Error(`template.json's agentSetup.merge asks for "${merge.how}" on ${rel}, which this version of create-abap2ui5-app cannot do - update it`);
    }
  }

  for (const [rel, variants] of Object.entries(setup.existingVariants?.files ?? {})) {
    for (const v of variants) {
      if (fs.existsSync(path.join(dir, v)) && actions.find((a) => a.path === rel)?.kind === 'add') {
        warnings.push(`this project has ${v}, and now ${rel} as well - \`npm run check:abap\` and the pin check read ${rel}; `
          + `move your rules into it and delete ${v}, or keep both on purpose`);
      }
    }
  }
  return { folder, from, actions, warnings };
}

/** Writes the plan's `add` and `merge` actions. */
export function writePlan(dir, actions) {
  for (const a of actions) {
    if (a.kind === 'skip') continue;
    fs.mkdirSync(path.join(dir, path.dirname(a.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, a.path), a.bytes);
  }
}

/**
 * The offline half of `npm run check:pin`, over the finished project - by the
 * project's own scripts/check-pin.mjs, not by a copy of its patterns, and only
 * when that file is the template's (never somebody else's code). A project
 * that kept its own AGENTS.md or abaplint.jsonc usually names no pin there,
 * and check.yml's first step would fail on its first push.
 */
export async function pinProblems(dir, templateCheckPin) {
  const file = path.join(dir, 'scripts/check-pin.mjs');
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(templateCheckPin)) return [];
  try {
    const { readPinSites } = await import(pathToFileURL(file).href);
    return readPinSites(dir).problems;
  } catch {
    return [];
  }
}

export function agentSetupNextSteps(dir, { folder, wroteAgents }) {
  const agents = wroteAgents
    ? `
AGENTS.md's first section ("This repository") describes a project made from
the template - zcl_app_001 in src/. Rewrite it for this one and keep
everything from "1. The model in one paragraph" down: that half is the
app-building reference, and it is the same for every abap2UI5 app.
`
    : '';
  const cd = dir === '.' ? '' : `\n  cd ${dir}`;
  return `
Next:
${cd}
  npm install                     # both gates; writes package-lock.json - commit it, check.yml runs npm ci
  npx playwright install chromium # once - only the render gate needs a browser
  npm run check                   # abaplint + abap2UI5-linter over ${folder}/
  npm run doctor                  # when something above does not look right
${agents}
Only after the agent knowledge, without the gates? In Claude Code the
framework's plugin brings the four skills and the MCP server to any project:

  /plugin marketplace add abap2UI5/abap2UI5
  /plugin install abap2ui5@abap2ui5
`;
}
