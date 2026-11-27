#!/usr/bin/env node
/*
 * create-abap2ui5-app — `npm create abap2ui5-app@latest my-app -- --class zcl_my_app`
 *
 * The fourth way to start an abap2UI5 project from abap2UI5/app-template, and
 * the one that needs neither a GitHub account ("Use this template"), nor VS
 * Code ("New Project from Template"), nor an MCP client (`scaffold_app`). It
 * does what those do: reads the template's `template.json`, takes every file
 * in `files.shared` and `files.named`, applies the substitutions that
 * description names, and writes a project directory.
 *
 * It carries NO list of files and NO list of substitutions of its own. Both
 * come from `template.json`, fetched from the template's main branch at run
 * time (or read from a local checkout with `--from`), so a file added to the
 * template reaches this package without a release. `main` is resolved to its
 * commit once, and every file is fetched from that commit: a push landing
 * while the files download cannot give a project half of each. What it does carry is the
 * substitution code, `./substitute.mjs` - a byte-equal copy of the template's
 * `scripts/lib/substitute.mjs`, the same functions `scripts/rename.mjs` runs
 * over a checkout. Same description, same code: a project started with
 * `npm create` is the project "Use this template" + `rename` produces.
 *
 * Files are fetched and written as BYTES. The abapGit sidecars (`.clas.xml`,
 * `.abapgit.xml`, `package.devc.xml`) begin with a UTF-8 BOM that abapGit
 * writes and expects back, and a text round trip that normalises it away
 * produces a project whose first pull into a system shows a diff on every
 * sidecar. Only the files a substitution names go through text, and the BOM
 * survives that too (Node keeps U+FEFF through utf8 decode/encode).
 *
 * Usage:
 *   npm create abap2ui5-app@latest my-app -- --class zcl_my_app
 *       [--package "My App"] [--repo my-app] [--from <local app-template checkout>]
 *   npm create abap2ui5-app@latest -- --agent-setup [dir] [--from <checkout>]
 *
 * The second form is for a project that already exists - most abap2UI5
 * projects never started from the template. It adds the agent setup and the
 * gates to `dir` (default: the current directory) and never overwrites a file;
 * `./agent-setup.mjs` says how, `template.json`'s `agentSetup` says what.
 *
 * No dependencies: `fetch`, `fs` and `path` are all it needs, and Node 22 has
 * all three.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classNameProblem, substitutePath, substituteText, substitutedFiles } from './substitute.mjs';
import { agentSetupNextSteps, packageNameFor, pinProblems, planAgentSetup, writePlan } from './agent-setup.mjs';

export const REPO = 'abap2UI5/app-template';
/** The files of commit (or branch) `ref` of the template. */
export const rawBase = (ref) => `https://raw.githubusercontent.com/${REPO}/${ref}/`;
export const RAW = rawBase('main');
/** The commit main is on, as a bare SHA (the `sha` media type). */
export const COMMIT_API = `https://api.github.com/repos/${REPO}/commits/main`;
const SPEC_FILE = 'template.json';
/** How long one request may take before it is given up, in ms. */
export const TIMEOUT = { commit: 15000, file: 30000 };
/** abapGit's package description (DEVC CTEXT) holds 60 characters. */
export const PACKAGE_TEXT_MAX = 60;

const USAGE = `usage: npm create abap2ui5-app@latest <dir> -- --class <zcl_your_app> [--package "Your App"] [--repo <name>] [--from <checkout>]
       npm create abap2ui5-app@latest -- --agent-setup [<dir>] [--from <checkout>]

  <dir>      the project directory to create (must not exist, or be empty)
  --class    the app class, lower case: ^zcl_ or ^zcx_, at most 30 characters
             (the rule the template's abaplint.jsonc enforces)
  --package  the ABAP package description abapGit shows, at most 60 characters
             (default: kept as in the template)
  --repo     the repository name written to .abapgit.xml and package.json
             (default: the directory's name, in the characters npm accepts)
  --from     read the template from a local abap2UI5/app-template checkout
             instead of fetching it from GitHub

  --agent-setup
             add the template's agent setup (AGENTS.md, CLAUDE.md, .claude/,
             .mcp.json) and its two gates (lint configs, package.json scripts
             and devDependencies, .github/workflows/check.yml) to an EXISTING
             project in <dir> (default: the current directory). Never touches
             src/, never overwrites a file - it skips it and says so - and only
             adds to package.json and .gitignore. No --class: the project has
             its classes`;

/** The options that are switches, not `--name value` pairs. */
const FLAGS = { '--agent-setup': 'agentSetup' };

/** The command line, as a plain object. Exported for the tests. */
export function parseArgs(argv) {
  const out = { dir: undefined, class: undefined, package: undefined, repo: undefined, from: undefined, agentSetup: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (FLAGS[a]) out[FLAGS[a]] = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (!(key in out) || key === 'help' || key === 'dir' || key === 'agentSetup') throw new Error(`unknown option ${a}`);
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      out[key] = argv[++i];
    } else if (out.dir === undefined) out.dir = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

/** A fetch that gives up after `ms` with an error saying so. */
async function fetchWithin(fetchImpl, url, ms, init = {}) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error(`no answer from ${url} within ${ms / 1000} s`);
    throw err;
  }
}

/**
 * The commit the template's main branch is on - so every file comes from the
 * same one. When GitHub's API cannot say (offline from it, rate-limited), the
 * files come from `main` itself, with a warning: a push during the download
 * could then mix two commits.
 */
export async function resolveCommit({ fetchImpl = globalThis.fetch, warn = (m) => console.warn(m) } = {}) {
  try {
    const res = await fetchWithin(fetchImpl, COMMIT_API, TIMEOUT.commit, { headers: { accept: 'application/vnd.github.sha' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sha = (await res.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`the answer is no commit SHA: ${JSON.stringify(sha.slice(0, 60))}`);
    return sha;
  } catch (err) {
    warn(`create-abap2ui5-app: warning: could not resolve the template's main to a commit (${err.message}) - `
      + 'reading the branch main instead; should a commit land while the files download, the project could mix two versions');
    return 'main';
  }
}

/** A path template.json names is used relative to the template and to the
 *  project: one that is absolute or climbs out with `..` is refused. */
export function pathProblem(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return `${JSON.stringify(rel)} is not a file path`;
  const posix = rel.replace(/\\/g, '/');
  if (path.posix.isAbsolute(posix) || path.win32.isAbsolute(rel)) return `${rel} is an absolute path`;
  const norm = path.posix.normalize(posix);
  if (norm === '..' || norm.startsWith('../')) return `${rel} leads outside the project`;
  return null;
}

/** Where the template's files come from: a checkout on disk, or GitHub at one
 *  commit. Both answer in bytes, for the reason in the header. Exported for
 *  the tests. */
export async function sourceFor(from, { fetchImpl = globalThis.fetch, warn } = {}) {
  if (from) {
    const root = path.resolve(from);
    if (!fs.existsSync(path.join(root, SPEC_FILE))) {
      throw new Error(`${root} has no ${SPEC_FILE} - --from wants an abap2UI5/app-template checkout`);
    }
    return { name: root, read: async (rel) => fs.readFileSync(path.join(root, rel)) };
  }
  const ref = await resolveCommit({ fetchImpl, warn });
  const base = rawBase(ref);
  return {
    name: base,
    ref,
    read: async (rel) => {
      const refused = pathProblem(rel);
      if (refused) throw new Error(`template.json names ${refused}`);
      const res = await fetchWithin(fetchImpl, base + rel, TIMEOUT.file);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${base}${rel}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/**
 * The project, as a list of { path, bytes } - computed from the spec and the
 * template's files without touching the target directory, so the tests can
 * look at it and so nothing is written when a later file fails to fetch.
 */
export async function materialise(spec, read, { newClass, newPackage, newRepo }) {
  const textual = substitutedFiles(spec);
  const oldClass = spec.placeholderClass;
  const renames = spec.substitutions.class.renamesPath;
  const files = [];
  for (const rel of [...spec.files.shared, ...spec.files.named]) {
    const refused = pathProblem(rel);
    if (refused) throw new Error(`template.json names ${refused}`);
    const bytes = await read(rel);
    const out = substitutePath(rel, oldClass, newClass, renames);
    const outRefused = pathProblem(out);
    if (outRefused) throw new Error(`template.json names ${outRefused}`);
    if (!textual.has(rel)) {
      files.push({ path: out, bytes });
      continue;
    }
    const text = substituteText(rel, bytes.toString('utf8'), spec, { newClass, newPackage, newRepo });
    files.push({ path: out, bytes: Buffer.from(text, 'utf8') });
  }
  return files;
}

/** Empty, or not there yet: the only two states a NEW project's directory may
 *  be in. Adding to somebody's existing project is --agent-setup's job, which
 *  takes a narrower set of files and never overwrites one. */
export function targetProblem(dir) {
  if (!fs.existsSync(dir)) return null;
  if (!fs.statSync(dir).isDirectory()) return `${dir} exists and is not a directory`;
  if (fs.readdirSync(dir).length) return `${dir} exists and is not empty`;
  return null;
}

export function nextSteps(dir, newClass) {
  return `
Done. Next:

  cd ${dir}
  npm ci                          # the two gates, from the lockfile
  npx playwright install chromium # once - only the render gate needs a browser
  npm run check                   # abaplint + abap2UI5-linter, expect 0 issues
  npm run doctor                  # when something above does not look right

Then deploy the repository into your system with abapGit (https://abapgit.org/)
and start the app with <icf-endpoint>?app_start=${newClass.toUpperCase()}.
AGENTS.md briefs an agent (and you): the repository, the essentials of building
an app, and where the full guide is; README.md is yours to write.
`;
}

/**
 * The project written into a temporary directory next to `dir` and renamed to
 * `dir` at the end, so a failure half-way (a full disk, a name the file system
 * refuses) leaves no half project behind - the temporary directory is removed
 * and `dir` is as it was. Every file has to land inside the project.
 */
export function writeProject(dir, files) {
  const parent = path.dirname(dir);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(parent, `.${path.basename(dir)}.create-`));
  const existed = fs.existsSync(dir);
  try {
    for (const f of files) {
      const target = path.resolve(tmp, f.path);
      if (pathProblem(f.path) || !target.startsWith(tmp + path.sep)) throw new Error(`${f.path} would land outside the project`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.bytes);
    }
    // an empty directory the user made for it gives way to the finished one
    if (existed) fs.rmdirSync(dir);
    try {
      fs.renameSync(tmp, dir);
    } catch (err) {
      if (existed && !fs.existsSync(dir)) fs.mkdirSync(dir);
      throw err;
    }
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** An existing directory: the only state --agent-setup writes into. A
 *  directory that is not there yet is a new project, which is the other mode. */
export function agentTargetProblem(dir) {
  if (!fs.existsSync(dir)) return `${dir} does not exist - --agent-setup adds to an existing project; for a new one leave --agent-setup out and pass --class`;
  if (!fs.statSync(dir).isDirectory()) return `${dir} exists and is not a directory`;
  return null;
}

async function agentSetup(args) {
  for (const opt of ['class', 'package', 'repo']) {
    if (args[opt] !== undefined) {
      console.error(`create-abap2ui5-app: --${opt} has no meaning with --agent-setup - it adds to a project that already has its classes, package and name\n\n${USAGE}`);
      return 2;
    }
  }
  const shown = args.dir ?? '.';
  const dir = path.resolve(shown);
  const busy = agentTargetProblem(dir);
  if (busy) {
    console.error(`create-abap2ui5-app: ${busy}`);
    return 2;
  }

  let source;
  try {
    source = await sourceFor(args.from);
  } catch (err) {
    console.error(`create-abap2ui5-app: ${err.message}`);
    return 2;
  }
  let spec;
  try {
    spec = JSON.parse((await source.read(SPEC_FILE)).toString('utf8'));
  } catch (err) {
    console.error(`create-abap2ui5-app: could not read the template's ${SPEC_FILE} from ${source.name} (${err.message})`);
    return 1;
  }
  if (!spec.agentSetup?.files) {
    console.error(`create-abap2ui5-app: the template's ${SPEC_FILE} (${source.name}) has no agentSetup - it predates --agent-setup`);
    return 1;
  }

  let plan;
  let templateCheckPin = null;
  try {
    plan = await planAgentSetup(spec, source.read, dir);
    if (spec.agentSetup.files['scripts/check-pin.mjs']) templateCheckPin = await source.read('scripts/check-pin.mjs');
  } catch (err) {
    console.error(`create-abap2ui5-app: ${err.message} - nothing was written`);
    return 1;
  }
  try {
    writePlan(dir, plan.actions);
  } catch (err) {
    console.error(`create-abap2ui5-app: writing into ${dir} failed: ${err.message} - files before it may have been written; `
      + 'run it again once the cause is fixed (it never overwrites, so a second run only completes the first)');
    return 1;
  }

  const width = Math.max(...plan.actions.map((a) => a.path.length));
  const verb = { add: 'added', merge: 'merged', skip: 'skipped' };
  console.log(`create-abap2ui5-app --agent-setup: ${dir}`);
  console.log(`  template   ${source.name}`);
  console.log(`  sources    ${plan.folder}/ (${plan.from})`);
  for (const a of plan.actions) {
    console.log(`  ${verb[a.kind].padEnd(8)} ${a.detail ? `${a.path.padEnd(width)}  ${a.detail}` : a.path}`);
  }
  const written = plan.actions.filter((a) => a.kind !== 'skip').length;
  const skipped = plan.actions.length - written;
  console.log(`create-abap2ui5-app: ${written} written, ${skipped} skipped${written ? '' : ' - the agent setup was already complete, nothing to do'}`);

  const warnings = [...plan.warnings];
  // Whose check:pin check.yml's first step runs: the template's, or one the
  // project kept - the doctor reads the template's either way.
  const scriptOf = (text) => {
    try {
      return JSON.parse(text).scripts?.['check:pin'];
    } catch {
      return undefined;
    }
  };
  const pkgFile = path.join(dir, 'package.json');
  const ownsCheckPin = fs.existsSync(pkgFile)
    && scriptOf(fs.readFileSync(pkgFile, 'utf8')) === scriptOf((await source.read('package.json')).toString('utf8'));
  if (templateCheckPin) {
    const pin = await pinProblems(dir, templateCheckPin);
    if (pin.length) {
      const who = ownsCheckPin
        ? '`npm run check:pin` (the first step of check.yml) and `npm run doctor` would fail as things stand:'
        : '`npm run doctor` would report the framework pin as FAIL (your own check:pin script is not affected):';
      warnings.push(`${who}\n`
        + pin.map((p) => `      ${p.split('\n').join('\n      ')}`).join('\n')
        + '\n    abaplint.jsonc\'s "branch" is the framework pin - a release tag such as "1.145.0", not a branch - and\n'
        + '    every other place that names a release has to agree with it; scripts/check-pin.mjs lists the places');
    }
  }
  if (warnings.length) {
    console.log('\nWorth knowing:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  const wroteAgents = plan.actions.some((a) => a.path === 'AGENTS.md' && a.kind === 'add');
  console.log(agentSetupNextSteps(shown, { folder: plan.folder, wroteAgents }));
  return 0;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`create-abap2ui5-app: ${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.agentSetup && !args.help) return agentSetup(args);
  if (args.help || !args.dir) {
    console.error(USAGE);
    return args.help ? 0 : 2;
  }
  const dir = path.resolve(args.dir);
  const newClass = (args.class || '').toLowerCase();
  if (!newClass) {
    console.error(`create-abap2ui5-app: --class is required\n\n${USAGE}`);
    return 2;
  }

  const newPackage = args.package;
  if (newPackage !== undefined && [...newPackage].length > PACKAGE_TEXT_MAX) {
    console.error(`create-abap2ui5-app: --package is ${[...newPackage].length} characters long - abapGit's package description holds at most ${PACKAGE_TEXT_MAX}`);
    return 2;
  }

  let source;
  try {
    source = await sourceFor(args.from);
  } catch (err) {
    console.error(`create-abap2ui5-app: ${err.message}`);
    return 2;
  }

  let spec;
  try {
    spec = JSON.parse((await source.read(SPEC_FILE)).toString('utf8'));
  } catch (err) {
    console.error(`create-abap2ui5-app: could not read the template's ${SPEC_FILE} from ${source.name} (${err.message})`);
    return 1;
  }

  const refused = classNameProblem(newClass, spec.substitutions.class);
  if (refused) {
    console.error(`create-abap2ui5-app: ${refused}`);
    return 2;
  }
  const busy = targetProblem(dir);
  if (busy) {
    console.error(`create-abap2ui5-app: ${busy}`);
    return 2;
  }

  // package.json's name is the repository name: from the directory, in the
  // characters npm accepts - as --agent-setup names a package.json it writes
  const newRepo = args.repo || packageNameFor(dir);

  let files;
  try {
    files = await materialise(spec, source.read, { newClass, newPackage, newRepo });
  } catch (err) {
    console.error(`create-abap2ui5-app: could not read the template from ${source.name} (${err.message}) - nothing was written`);
    return 1;
  }

  try {
    writeProject(dir, files);
  } catch (err) {
    console.error(`create-abap2ui5-app: writing ${dir} failed (${err.message}) - nothing was left behind`);
    return 1;
  }

  console.log(`create-abap2ui5-app: ${files.length} files from ${source.name}`);
  console.log(`  class      ${spec.placeholderClass} -> ${newClass}`);
  if (newPackage) console.log(`  package    ${newPackage}`);
  console.log(`  repository ${newRepo}`);
  console.log(nextSteps(args.dir, newClass));
  return 0;
}

/* Run as a command, not imported by the tests. `npm create` / `npm exec`
 * start the package through its node_modules/.bin link: process.argv[1] is
 * the LINK, while import.meta.url is the file it resolves to - compared as
 * they came, the two never matched, and the command printed nothing and
 * exited 0. Hence the realpath; and fileURLToPath rather than a URL's
 * pathname, which keeps %20 for a space and a leading /C: on Windows. */
export function invokedAsCommand(argv1 = process.argv[1], self = import.meta.url) {
  if (!argv1) return false;
  try {
    return fs.realpathSync(path.resolve(argv1)) === fs.realpathSync(fileURLToPath(self));
  } catch {
    return false;
  }
}
if (invokedAsCommand()) process.exit(await main(process.argv.slice(2)));
