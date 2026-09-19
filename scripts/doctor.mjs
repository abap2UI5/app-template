#!/usr/bin/env node
/*
 * doctor — is this machine able to run the gates, and does this repository
 * still agree with itself? One line per check, offline, in seconds.
 *
 *   npm run doctor
 *
 * The two gates fail in ways that name the symptom and not the cause: abaplint
 * dies on an old Node with a syntax error in somebody else's file, the render
 * gate says "browser not found" from inside playwright, `npm run check` passes
 * locally against a linter one minor older than the one CI runs, and a
 * `.clas.xml` saved without its BOM shows up as a diff on the next abapGit
 * pull - for everyone. Each of those has a one-line remedy, and this prints
 * it next to the finding instead of leaving it to be worked out from a stack.
 *
 *   OK    the check passed
 *   WARN  worth knowing, nothing is broken - the run stays green
 *   FAIL  a gate would fail, or a pull into a system would misbehave - exit 1
 *
 * Offline first: nothing here touches the network. The framework pin is read
 * through scripts/check-pin.mjs (the same patterns, not a copy of them), and
 * the "is it the newest release" half of that script is deliberately left to
 * `npm run check:pin`.
 *
 * Two checks are optional and never fail: whether VS Code has the abap2UI5
 * extension (only when `code` is on PATH), and the linter's compatibility
 * record (`data/compat.json`), which older linter versions do not ship.
 *
 * The decisions are exported as pure functions and unit-tested in
 * scripts/test/doctor.test.mjs; the I/O is in main() below. This file ships
 * with every project made from the template, so it must run in a project:
 * nothing here reads template.json or README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPinSites } from './check-pin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------- versions */

/** `^0.6.1`, `v22.1.0`, `22` -> [major, minor, patch] (missing parts are 0);
 *  null when it is not a version at all. */
export function parseVersion(v) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v ?? ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function cmpVersion(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The linter and its render runtime are cut from one tag; "the same minor
 *  line" is major.minor equal. */
export function sameMinor(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  return Boolean(x && y) && x[0] === y[0] && x[1] === y[1];
}

/* ------------------------------------------------------------- jsonc */

/** abap2ui5lint.jsonc is JSON with comments and trailing commas, which
 *  JSON.parse refuses. This strips both, outside strings only. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
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
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/* ------------------------------------------------------------- decisions */

const ok = (text) => ({ status: 'OK', text });
const warn = (text, remedy) => ({ status: 'WARN', text, remedy });
const fail = (text, remedy) => ({ status: 'FAIL', text, remedy });

export function checkNode(running, wanted) {
  const want = parseVersion(wanted);
  if (!want) return warn(`node ${running} - .nvmrc names no version`, 'write the major version the gates need into .nvmrc (22)');
  if (cmpVersion(running, wanted) >= 0) return ok(`node ${running} (.nvmrc asks for ${String(wanted).trim()})`);
  return fail(`node ${running} is older than the ${String(wanted).trim()} .nvmrc asks for`,
    `install Node ${String(wanted).trim()} or newer (nvm: \`nvm install\` reads .nvmrc)`);
}

/** `installed` maps package name -> version or null. */
export function checkInstalled(installed) {
  const missing = Object.entries(installed).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    return fail(`node_modules is missing ${missing.join(', ')}`, 'run `npm ci` (it installs both gates from package-lock.json)');
  }
  return ok(Object.entries(installed).map(([k, v]) => `${k}@${v}`).join(', '));
}

export function checkSameMinor(linter, runtime) {
  if (!linter || !runtime) return fail('the linter or its render runtime is not installed', 'run `npm ci`');
  if (sameMinor(linter, runtime)) return ok(`@abap2ui5/linter ${linter} and @abap2ui5/render-runtime ${runtime} are on one minor line`);
  return fail(`@abap2ui5/linter ${linter} and @abap2ui5/render-runtime ${runtime} are not on the same minor line - they are cut from one tag`,
    `npm install -D @abap2ui5/linter@${linter} @abap2ui5/render-runtime@${parseVersion(linter).slice(0, 2).join('.')}`);
}

/**
 * How the render gate finds a browser (@abap2ui5/linter's lib/render.mjs):
 * playwright's own registry first - PLAYWRIGHT_BROWSERS_PATH, else its
 * per-user cache - and when that launch fails, CHROMIUM_BIN and three fixed
 * system paths. `executablePath` is what playwright would launch, `exists`
 * whether that file is there, `fallback` the first of the linter's fallbacks
 * that exists (or null).
 */
export function checkChromium({ playwright, executablePath, exists, fallback, browsersPath }) {
  const where = browsersPath ? ` (PLAYWRIGHT_BROWSERS_PATH=${browsersPath})` : '';
  if (!playwright) return fail('playwright is not installed - the render gate has no browser driver', 'run `npm ci`, then `npx playwright install chromium`');
  if (exists) return ok(`chromium for the render gate: ${executablePath}${where}`);
  if (fallback) return ok(`chromium for the render gate: ${fallback} (the linter's fallback; playwright's own ${executablePath} is absent${where})`);
  return fail(`no chromium for the render gate - playwright expects ${executablePath}${where}`,
    'run `npx playwright install chromium` (or `npm run check:abap2ui5:fast` to skip the render gate)');
}

export function checkPin({ found, distinct, problems }) {
  if (problems.length) return fail(`the framework pin: ${problems[0].split('\n')[0]}`, 'run `npm run check:pin` for the full report and move the places together');
  return ok(`framework ${distinct[0]} pinned in ${found.length} place(s): ${found.map((f) => f.file).join(', ')}`);
}

/** The linter version CI runs comes from the Action pin in check.yml, the one
 *  `npm run check` runs from package.json; a rule can differ between the two. */
export function checkActionPin(actionVersion, devRange) {
  if (!devRange) return fail('package.json has no @abap2ui5/linter devDependency', 'add it: `npm install -D @abap2ui5/linter @abap2ui5/render-runtime`');
  if (!actionVersion) {
    return warn('check.yml names no abap2UI5/linter action version this can read (expected `uses: abap2UI5/linter@<sha> # vX.Y.Z`)',
      'keep the version tag in the comment next to the SHA pin so the pairing stays checkable');
  }
  if (sameMinor(actionVersion, devRange)) return ok(`the abap2UI5/linter action (v${parseVersion(actionVersion).join('.')}) and the devDependency (${devRange}) are on one minor line`);
  return warn(`CI lints with abap2UI5/linter v${parseVersion(actionVersion).join('.')}, \`npm run check\` with ${devRange} - a rule can differ between the two`,
    'move the SHA pin in .github/workflows/check.yml to the release matching package.json (Dependabot opens that PR weekly)');
}

/** One class: its sidecar has to exist, start with the UTF-8 BOM, use LF, and
 *  name the class the file name says. A class with a test include is flagged
 *  for abapGit through WITH_UNIT_TESTS. */
export function checkSidecar({ abap, xml, hasTests }) {
  const base = path.basename(abap, '.clas.abap');
  const xmlName = `src/${base}.clas.xml`;
  if (!xml) return fail(`${abap}: no ${xmlName} sidecar - abapGit cannot import the class`, `copy an existing .clas.xml, set <CLSNAME>${base.toUpperCase()}</CLSNAME>`);
  const defects = [];
  if (!(xml[0] === 0xef && xml[1] === 0xbb && xml[2] === 0xbf)) defects.push('no UTF-8 BOM');
  const text = xml.toString('utf8');
  if (text.includes('\r')) defects.push('CRLF line endings');
  const clsname = /<CLSNAME>([^<]*)<\/CLSNAME>/.exec(text)?.[1];
  if (clsname !== base.toUpperCase()) defects.push(`CLSNAME is ${clsname ? `"${clsname}"` : 'missing'}, the file says ${base.toUpperCase()}`);
  if (defects.length) {
    return fail(`${xmlName}: ${defects.join('; ')}`,
      'a sidecar is a serialization abapGit writes and reads back byte for byte - copy a good one (BOM, LF) and fix CLSNAME; abaplint\'s xml_bom / xml_consistency fail on this too');
  }
  if (hasTests && !/<WITH_UNIT_TESTS>X<\/WITH_UNIT_TESTS>/.test(text)) {
    return warn(`${xmlName}: ${base}.clas.testclasses.abap exists but VSEOCLASS has no <WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>`,
      'add the element after <UNICODE>X</UNICODE>, the way abapGit serializes a class with local test classes');
  }
  return ok(`${xmlName}: BOM, LF, CLSNAME ${clsname}${hasTests ? ', WITH_UNIT_TESTS' : ''}`);
}

/** `exists` answers whether a configured path is there. */
export function checkLintConfig(text, exists) {
  let cfg;
  try {
    cfg = parseJsonc(text);
  } catch (err) {
    return fail(`abap2ui5lint.jsonc does not parse: ${err.message}`, 'fix the JSON (comments and trailing commas are fine, the rest has to be JSON)');
  }
  if (!Array.isArray(cfg.paths) || !cfg.paths.length) {
    return warn('abap2ui5lint.jsonc names no `paths` - the linter falls back to its default', 'add `"paths": ["src"]` so the gate says what it covers');
  }
  const missing = cfg.paths.filter((p) => !exists(p));
  if (missing.length) return fail(`abap2ui5lint.jsonc names paths that do not exist: ${missing.join(', ')}`, 'point `paths` at the directories that hold the app classes');
  return ok(`abap2ui5lint.jsonc parses; paths ${cfg.paths.join(', ')} exist${cfg.render === true ? '; render gate required' : ''}`);
}

/** `extensions` is the output of `code --list-extensions`, or null when
 *  `code` is not on PATH. Never fails: an editor is not a gate. */
export function checkExtension(extensions) {
  if (extensions === null) return ok('VS Code: `code` is not on PATH - extension check skipped');
  const ids = extensions.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (ids.includes('abap2ui5.abap2ui5')) return ok('VS Code has the abap2UI5 extension (abap2ui5.abap2ui5)');
  return warn('VS Code does not have the abap2UI5 extension', 'run `code --install-extension abap2ui5.abap2ui5` (linter findings as you type, F9 preview, MCP for Copilot)');
}

/**
 * The linter's compatibility record, when it ships one:
 *   { linter, framework: { minimum, mirrored }, ui5: { floor, snapshot } }
 * `framework.minimum` is the oldest framework release its rules were written
 * against. Absent in older linters, which is an OK line and not a defect.
 */
export function checkCompat(compat, pinned) {
  if (!compat) return ok('linter compatibility record (data/compat.json): not shipped by this linter version');
  const min = compat.framework?.minimum;
  if (!min || !parseVersion(min)) return warn('the linter\'s data/compat.json names no framework.minimum', 'nothing to do - the record is the linter\'s to fix');
  if (!pinned) return warn(`the linter needs framework ${min} or newer, and this repository pins no readable release`, 'run `npm run check:pin`');
  if (cmpVersion(pinned, min) < 0) {
    return fail(`this repository pins framework ${pinned}; @abap2ui5/linter ${compat.linter ?? ''} needs ${min} or newer`.replace(/\s+/g, ' '),
      `move the pin to ${min} or newer (abaplint.jsonc, AGENTS.md, README.md - \`npm run check:pin\` lists them) or pin an older linter`);
  }
  const extra = [compat.framework?.mirrored ? `mirrored ${compat.framework.mirrored}` : '', compat.ui5?.floor ? `UI5 floor ${compat.ui5.floor}` : ''].filter(Boolean).join(', ');
  return ok(`framework ${pinned} satisfies the linter's minimum ${min}${extra ? ` (${extra})` : ''}`);
}

/** The whole report's verdict: exit 1 only when something FAILed. */
export function summarise(results) {
  const n = (s) => results.filter((r) => r.status === s).length;
  return { fails: n('FAIL'), warns: n('WARN'), oks: n('OK'), exitCode: n('FAIL') ? 1 : 0 };
}

/* ------------------------------------------------------------- the I/O */

const readIf = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : null);
const installedVersion = (pkg) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

async function findChromium() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
  let resolved = null;
  for (const from of [path.join(ROOT, 'package.json'), path.join(ROOT, 'node_modules/@abap2ui5/render-runtime/package.json')]) {
    try {
      resolved = createRequire(from).resolve('playwright');
      break;
    } catch { /* try the next */ }
  }
  if (!resolved) return { playwright: false, browsersPath };
  let executablePath = '';
  try {
    const pw = await import(pathToFileURL(resolved).href);
    const chromium = pw.chromium ?? pw.default?.chromium;
    executablePath = chromium.executablePath();
  } catch (err) {
    return { playwright: true, executablePath: `(playwright could not say: ${err.message})`, exists: false, fallback: null, browsersPath };
  }
  const fallbacks = [process.env.CHROMIUM_BIN, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const fallback = fallbacks.find((exe) => exe && fs.existsSync(exe)) || null;
  return { playwright: true, executablePath, exists: Boolean(executablePath) && fs.existsSync(executablePath), fallback, browsersPath };
}

function listExtensions() {
  const r = spawnSync('code', ['--list-extensions'], { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) return null;
  return r.stdout || '';
}

async function main() {
  const results = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  results.push(checkNode(process.version, readIf('.nvmrc') ?? ''));

  const linter = installedVersion('@abap2ui5/linter');
  const runtime = installedVersion('@abap2ui5/render-runtime');
  const abaplint = installedVersion('@abaplint/cli');
  results.push(checkInstalled({ '@abap2ui5/linter': linter, '@abap2ui5/render-runtime': runtime, '@abaplint/cli': abaplint }));
  results.push(checkSameMinor(linter, runtime));
  results.push(checkChromium(await findChromium()));

  const pin = readPinSites(ROOT);
  results.push(checkPin(pin));

  const workflow = readIf('.github/workflows/check.yml') ?? '';
  const action = /uses:\s*abap2UI5\/linter@(?:[0-9a-f]{40}\s*#\s*v?(\d+\.\d+\.\d+)|v?(\d+\.\d+\.\d+)\b)/.exec(workflow);
  results.push(checkActionPin(action ? (action[1] || action[2]) : null, pkg.devDependencies?.['@abap2ui5/linter']));

  const srcDir = path.join(ROOT, 'src');
  const classes = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.clas.abap')).sort() : [];
  if (!classes.length) results.push(warn('src/ holds no *.clas.abap', 'every app is one ZCL_* class in src/ with its .clas.xml sidecar - the template ships one starter class there'));
  for (const abap of classes) {
    const base = abap.slice(0, -'.clas.abap'.length);
    const xmlPath = path.join(srcDir, `${base}.clas.xml`);
    results.push(checkSidecar({
      abap: `src/${abap}`,
      xml: fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath) : null,
      hasTests: fs.existsSync(path.join(srcDir, `${base}.clas.testclasses.abap`)),
    }));
  }

  const lintCfg = readIf('abap2ui5lint.jsonc');
  results.push(lintCfg === null
    ? fail('abap2ui5lint.jsonc is missing', 'the linter reads its paths, UI5 floor and severities from it - restore it from the template')
    : checkLintConfig(lintCfg, (p) => fs.existsSync(path.join(ROOT, p))));

  results.push(checkExtension(listExtensions()));

  const compatPath = path.join(ROOT, 'node_modules/@abap2ui5/linter/data/compat.json');
  let compat = null;
  if (fs.existsSync(compatPath)) {
    try {
      compat = JSON.parse(fs.readFileSync(compatPath, 'utf8'));
    } catch (err) {
      results.push(warn(`the linter's data/compat.json does not parse (${err.message})`, 'nothing to do here - the record is the linter\'s to fix'));
    }
  }
  if (compat || !fs.existsSync(compatPath)) results.push(checkCompat(compat, pin.distinct.length === 1 ? pin.distinct[0] : null));

  console.log('doctor: the gates and this repository, checked offline');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(5)} ${r.text}`);
    if (r.remedy) console.log(`        -> ${r.remedy}`);
  }
  const { fails, warns, oks, exitCode } = summarise(results);
  console.log(`doctor: ${oks} OK, ${warns} WARN, ${fails} FAIL${fails ? ' - fix the FAIL lines, then `npm run check`' : ' - run `npm run check`'}`);
  process.exit(exitCode);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
