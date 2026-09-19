/*
 * Unit tests for scripts/doctor.mjs - the decisions, as pure functions, and
 * the two claims the script makes about this repository's own files (the
 * Action pin pattern still matches check.yml; the real sidecars pass).
 *
 *   node --test scripts/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseVersion, cmpVersion, sameMinor, parseJsonc,
  checkNode, checkInstalled, checkSameMinor, checkChromium, checkPin, checkActionPin,
  checkSidecar, checkLintConfig, checkExtension, checkCompat, checkWatch, summarise,
} from '../doctor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const sidecar = (cls, extra = '') => Buffer.concat([BOM, Buffer.from(
  `<?xml version="1.0" encoding="utf-8"?>\n<abapGit>\n <VSEOCLASS>\n  <CLSNAME>${cls}</CLSNAME>\n  <UNICODE>X</UNICODE>\n${extra} </VSEOCLASS>\n</abapGit>\n`)]);

test('doctor: versions - caret, v-prefix and bare majors all parse', () => {
  assert.deepEqual(parseVersion('^0.6.1'), [0, 6, 1]);
  assert.deepEqual(parseVersion('v22.1.0'), [22, 1, 0]);
  assert.deepEqual(parseVersion('22'), [22, 0, 0]);
  assert.equal(parseVersion('none'), null);
  assert.ok(cmpVersion('0.10.0', '0.9.9') > 0);
  assert.ok(cmpVersion('1.144.0', '1.143.0') > 0);
  assert.equal(cmpVersion('0.6.1', '^0.6.1'), 0);
  assert.ok(sameMinor('0.6.1', '0.6.3'));
  assert.ok(!sameMinor('0.6.1', '0.7.0'));
  assert.ok(!sameMinor('0.6.1', null));
});

test('doctor: JSONC - comments and trailing commas go, strings stay', () => {
  const text = `{
    // a comment with "quotes" and a // inside
    "paths": ["src", /* block */ "app"],
    "url": "https://example.test/x", /* trailing */
    "escaped": "a \\"b\\" // not a comment",
  }`;
  assert.deepEqual(parseJsonc(text), { paths: ['src', 'app'], url: 'https://example.test/x', escaped: 'a "b" // not a comment' });
  assert.throws(() => parseJsonc('{ "a": }'));
  // the real config parses and names the paths the linter reads
  assert.deepEqual(parseJsonc(read('abap2ui5lint.jsonc')).paths, ['src']);
});

test('doctor: node - older than .nvmrc fails, equal or newer passes', () => {
  assert.equal(checkNode('v22.4.0', '22\n').status, 'OK');
  assert.equal(checkNode('v24.0.0', '22').status, 'OK');
  const old = checkNode('v20.11.0', '22');
  assert.equal(old.status, 'FAIL');
  assert.match(old.remedy, /Node 22/);
  assert.equal(checkNode('v22.0.0', '').status, 'WARN');
});

test('doctor: installed gates - a missing package names npm ci', () => {
  assert.equal(checkInstalled({ a: '1.0.0', b: '2.0.0' }).status, 'OK');
  const r = checkInstalled({ '@abap2ui5/linter': '0.6.1', '@abaplint/cli': null });
  assert.equal(r.status, 'FAIL');
  assert.match(r.text, /@abaplint\/cli/);
  assert.match(r.remedy, /npm ci/);
});

test('doctor: linter and render runtime have to share a minor line', () => {
  assert.equal(checkSameMinor('0.6.1', '0.6.2').status, 'OK');
  const r = checkSameMinor('0.7.0', '0.6.1');
  assert.equal(r.status, 'FAIL');
  assert.match(r.remedy, /render-runtime@0\.7/);
  assert.equal(checkSameMinor(null, '0.6.1').status, 'FAIL');
});

test('doctor: chromium - playwright path, the linter fallback, or the install command', () => {
  assert.equal(checkChromium({ playwright: true, executablePath: '/x/chrome', exists: true, fallback: null, browsersPath: '' }).status, 'OK');
  const fb = checkChromium({ playwright: true, executablePath: '/x/chrome', exists: false, fallback: '/usr/bin/chromium', browsersPath: '' });
  assert.equal(fb.status, 'OK');
  assert.match(fb.text, /fallback/);
  const none = checkChromium({ playwright: true, executablePath: '/x/chrome', exists: false, fallback: null, browsersPath: '/opt/pw' });
  assert.equal(none.status, 'FAIL');
  assert.match(none.remedy, /npx playwright install chromium/);
  assert.match(none.text, /PLAYWRIGHT_BROWSERS_PATH=\/opt\/pw/);
  assert.equal(checkChromium({ playwright: false }).status, 'FAIL');
});

test('doctor: the framework pin - a check-pin problem is a FAIL with check:pin as the remedy', () => {
  assert.equal(checkPin({ found: [{ file: 'abaplint.jsonc' }], distinct: ['1.144.0'], problems: [] }).status, 'OK');
  const r = checkPin({ found: [], distinct: ['1.144.0', '1.143.0'], problems: ['the three places disagree: 1.144.0 / 1.143.0\n  ...'] });
  assert.equal(r.status, 'FAIL');
  assert.match(r.remedy, /check:pin/);
  assert.ok(!r.text.includes('\n'), 'one line per check');
});

test('doctor: the Action pin - a different minor line is a WARN, an unreadable one too, never a FAIL', () => {
  assert.equal(checkActionPin('0.6.1', '^0.6.1').status, 'OK');
  assert.equal(checkActionPin('0.5.1', '^0.6.1').status, 'WARN');
  assert.equal(checkActionPin(null, '^0.6.1').status, 'WARN');
  assert.equal(checkActionPin('0.6.1', undefined).status, 'FAIL');
});

test('doctor: the Action pin pattern still reads check.yml', () => {
  // The pattern is in doctor.mjs; the claim is about check.yml's shape.
  const src = read('scripts/doctor.mjs');
  const m = /const action = (\/.+\/)\.exec\(workflow\)/.exec(src);
  assert.ok(m, 'the Action pin pattern moved - update this test');
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')));
  const hit = re.exec(read('.github/workflows/check.yml'));
  assert.ok(hit, 'the pattern no longer matches check.yml - doctor would stop checking the pairing');
  assert.match(hit[1] || hit[2], /^\d+\.\d+\.\d+$/);
});

test('doctor: sidecars - BOM, LF, CLSNAME, and WITH_UNIT_TESTS for a class with tests', () => {
  assert.equal(checkSidecar({ abap: 'src/zcl_x.clas.abap', xml: sidecar('ZCL_X'), hasTests: false }).status, 'OK');
  assert.equal(checkSidecar({ abap: 'src/zcl_x.clas.abap', xml: null, hasTests: false }).status, 'FAIL');
  const noBom = checkSidecar({ abap: 'src/zcl_x.clas.abap', xml: sidecar('ZCL_X').subarray(3), hasTests: false });
  assert.equal(noBom.status, 'FAIL');
  assert.match(noBom.text, /BOM/);
  const crlf = checkSidecar({ abap: 'src/zcl_x.clas.abap', xml: Buffer.from(sidecar('ZCL_X').toString('utf8').replace(/\n/g, '\r\n'), 'utf8'), hasTests: false });
  assert.equal(crlf.status, 'FAIL');
  assert.match(crlf.text, /CRLF/);
  const wrong = checkSidecar({ abap: 'src/zcl_x.clas.abap', xml: sidecar('ZCL_Y'), hasTests: false });
  assert.equal(wrong.status, 'FAIL');
  assert.match(wrong.text, /CLSNAME is "ZCL_Y"/);
  const tests = checkSidecar({ abap: 'src/zcl_x.clas.abap', xml: sidecar('ZCL_X'), hasTests: true });
  assert.equal(tests.status, 'WARN');
  assert.match(tests.remedy, /UNICODE/);
  assert.equal(checkSidecar({ abap: 'src/zcl_x.clas.abap', xml: sidecar('ZCL_X', '  <WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>\n'), hasTests: true }).status, 'OK');
});

test('doctor: the real sidecars in src/ pass, test include included', () => {
  const src = path.join(ROOT, 'src');
  for (const abap of fs.readdirSync(src).filter((f) => f.endsWith('.clas.abap'))) {
    const base = abap.slice(0, -'.clas.abap'.length);
    const r = checkSidecar({
      abap: `src/${abap}`,
      xml: fs.readFileSync(path.join(src, `${base}.clas.xml`)),
      hasTests: fs.existsSync(path.join(src, `${base}.clas.testclasses.abap`)),
    });
    assert.equal(r.status, 'OK', `${abap}: ${r.text}`);
  }
});

test('doctor: the lint config - unparsable or pointing nowhere fails, no paths warns', () => {
  const exists = (p) => p === 'src';
  assert.equal(checkLintConfig('{ "paths": ["src"] }', exists).status, 'OK');
  assert.equal(checkLintConfig('{ "paths": ["src", "app"] }', exists).status, 'FAIL');
  assert.equal(checkLintConfig('{ "ui5": "1.71" }', exists).status, 'WARN');
  assert.equal(checkLintConfig('{ nope', exists).status, 'FAIL');
});

test('doctor: the VS Code extension is optional and never fails', () => {
  assert.equal(checkExtension(null).status, 'OK');
  assert.equal(checkExtension('larshp.vscode-abaplint\nabap2ui5.abap2ui5\n').status, 'OK');
  const r = checkExtension('ms-python.python\n');
  assert.equal(r.status, 'WARN');
  assert.match(r.remedy, /code --install-extension abap2ui5\.abap2ui5/);
});

test('doctor: the compatibility record - absent is fine, a pin below the minimum is not', () => {
  const absent = checkCompat(null, '1.144.0');
  assert.equal(absent.status, 'OK');
  assert.match(absent.text, /not shipped by this linter version/);
  const rec = { linter: '0.7.0', framework: { minimum: '1.145.0', mirrored: '1.146.0' }, ui5: { floor: '1.71', snapshot: '1.151.0' } };
  assert.equal(checkCompat(rec, '1.146.0').status, 'OK');
  assert.equal(checkCompat(rec, '1.145.0').status, 'OK');
  const low = checkCompat(rec, '1.144.0');
  assert.equal(low.status, 'FAIL');
  assert.match(low.text, /needs 1\.145\.0 or newer/);
  assert.equal(checkCompat({ linter: '0.7.0' }, '1.144.0').status, 'WARN');
  assert.equal(checkCompat(rec, null).status, 'WARN');
});

test('doctor: linter --watch - present is OK, absent is a WARN naming the bump, not installed is skipped, never a FAIL', () => {
  const has = checkWatch("else if (a === '--watch') watchMode = true;", '0.7.0');
  assert.equal(has.status, 'OK');
  assert.match(has.text, /npm run watch/);
  const not = checkWatch("else if (a === '--fix') opt.fix = true;", '0.6.1');
  assert.equal(not.status, 'WARN');
  assert.match(not.text, /0\.6\.1 has no --watch/);
  assert.match(not.remedy, /bump @abap2ui5\/linter/);
  assert.equal(checkWatch(null, null).status, 'OK');
  // the probe is the flag's spelling in the installed CLI's source; an empty
  // file is "no --watch", not a crash
  assert.equal(checkWatch('', '0.6.1').status, 'WARN');
  // and against the installed linter, whichever it is, the line never fails
  const cliPath = path.join(ROOT, 'node_modules/@abap2ui5/linter/cli.mjs');
  const real = checkWatch(fs.existsSync(cliPath) ? fs.readFileSync(cliPath, 'utf8') : null, '0.6.1');
  assert.ok(real.status !== 'FAIL', real.text);
});

test('doctor: the verdict - exit 1 only on FAIL', () => {
  assert.deepEqual(summarise([{ status: 'OK' }, { status: 'WARN' }]), { fails: 0, warns: 1, oks: 1, exitCode: 0 });
  assert.equal(summarise([{ status: 'OK' }, { status: 'FAIL' }]).exitCode, 1);
});

test('doctor: runs on this repository and prints one status line per check', () => {
  // In CI's self-check there is no node_modules; the run then FAILs on the
  // install lines and must say `npm ci`, not crash. With an install, it is
  // green.
  let code = 0;
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/doctor.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    code = err.status ?? 1;
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
  const lines = out.split('\n').filter((l) => /^\s+(OK|WARN|FAIL)\s/.test(l));
  assert.ok(lines.length >= 9, `expected one line per check, got:\n${out}`);
  if (fs.existsSync(path.join(ROOT, 'node_modules/@abap2ui5/linter'))) {
    assert.equal(code, 0, out);
  } else {
    assert.equal(code, 1, out);
    assert.match(out, /npm ci/);
  }
});
