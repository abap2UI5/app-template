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
 * template reaches this package without a release. What it does carry is the
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
 *
 * No dependencies: `fetch`, `fs` and `path` are all it needs, and Node 22 has
 * all three.
 */
import fs from 'node:fs';
import path from 'node:path';
import { classNameProblem, substitutePath, substituteText, substitutedFiles } from './substitute.mjs';

export const RAW = 'https://raw.githubusercontent.com/abap2UI5/app-template/main/';
const SPEC_FILE = 'template.json';

const USAGE = `usage: npm create abap2ui5-app@latest <dir> -- --class <zcl_your_app> [--package "Your App"] [--repo <name>] [--from <checkout>]

  <dir>      the project directory to create (must not exist, or be empty)
  --class    the app class, lower case: ^zcl_ or ^zcx_, at most 30 characters
             (the rule the template's abaplint.jsonc enforces)
  --package  the ABAP package description abapGit shows (default: kept as in the template)
  --repo     the repository name written to .abapgit.xml and package.json
             (default: the directory's name)
  --from     read the template from a local abap2UI5/app-template checkout
             instead of fetching it from GitHub`;

/** The command line, as a plain object. Exported for the tests. */
export function parseArgs(argv) {
  const out = { dir: undefined, class: undefined, package: undefined, repo: undefined, from: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (!(key in out) || key === 'help' || key === 'dir') throw new Error(`unknown option ${a}`);
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      out[key] = argv[++i];
    } else if (out.dir === undefined) out.dir = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

/** Where the template's files come from: a checkout on disk, or GitHub. Both
 *  answer in bytes, for the reason in the header. */
function sourceFor(from) {
  if (from) {
    const root = path.resolve(from);
    if (!fs.existsSync(path.join(root, SPEC_FILE))) {
      throw new Error(`${root} has no ${SPEC_FILE} - --from wants an abap2UI5/app-template checkout`);
    }
    return { name: root, read: async (rel) => fs.readFileSync(path.join(root, rel)) };
  }
  return {
    name: RAW,
    read: async (rel) => {
      const res = await fetch(RAW + rel, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${RAW}${rel}`);
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
    const bytes = await read(rel);
    const out = substitutePath(rel, oldClass, newClass, renames);
    if (!textual.has(rel)) {
      files.push({ path: out, bytes });
      continue;
    }
    const text = substituteText(rel, bytes.toString('utf8'), spec, { newClass, newPackage, newRepo });
    files.push({ path: out, bytes: Buffer.from(text, 'utf8') });
  }
  return files;
}

/** Empty, or not there yet: the only two states a target directory may be in.
 *  Writing into somebody's existing project is not a thing this does. */
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
AGENTS.md is the complete app-building reference; README.md is yours to write.
`;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`create-abap2ui5-app: ${err.message}\n\n${USAGE}`);
    return 2;
  }
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

  let source;
  try {
    source = sourceFor(args.from);
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

  const newRepo = args.repo || path.basename(dir);
  const newPackage = args.package;

  let files;
  try {
    files = await materialise(spec, source.read, { newClass, newPackage, newRepo });
  } catch (err) {
    console.error(`create-abap2ui5-app: could not read the template from ${source.name} (${err.message}) - nothing was written`);
    return 1;
  }

  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    fs.mkdirSync(path.join(dir, path.dirname(f.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, f.path), f.bytes);
  }

  console.log(`create-abap2ui5-app: ${files.length} files from ${source.name}`);
  console.log(`  class      ${spec.placeholderClass} -> ${newClass}`);
  if (newPackage) console.log(`  package    ${newPackage}`);
  console.log(`  repository ${newRepo}`);
  console.log(nextSteps(args.dir, newClass));
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) process.exit(await main(process.argv.slice(2)));
