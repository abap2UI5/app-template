/*
 * Unit tests for scripts/.
 *
 * All four programs find things by regex in files somebody else edits, and a
 * pattern that stops matching does not fail - it makes its gate pass by
 * checking nothing. check-pin.mjs says so about itself ("the file changed shape
 * - fix the pattern ... or this gate silently stops checking that place") and
 * until now nothing verified that the patterns still match.
 *
 * So the tests that matter here are not "does the function work" but "does the
 * claim this repository makes about its own files still hold".
 *
 *   node --test scripts/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const SPEC = json('template.json');
const PKG = json('package.json');

const run = (script, args = []) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

/* ---------------------------------------------------------------- check-pin */

test('check-pin: every non-optional site pattern still matches its file', () => {
  // The patterns are declared in check-pin.mjs; re-deriving them here would
  // test a copy. Read them out of the source instead, so an edited pattern is
  // an edited test subject.
  const src = read('scripts/check-pin.mjs');
  const block = src.slice(src.indexOf('const SITES = ['), src.indexOf('];', src.indexOf('const SITES = [')));
  const sites = [...block.matchAll(/file:\s*'([^']+)',\s*what:\s*'[^']*',\s*re:\s*(\/.*?\/),(\s*optional:\s*true,)?/gs)]
    .map(([, file, re, optional]) => ({ file, re, optional: Boolean(optional) }));

  assert.equal(sites.length, 3, 'expected three declared sites');
  for (const site of sites) {
    if (site.optional && !fs.existsSync(path.join(ROOT, site.file))) continue;
    const [body, flags] = [site.re.slice(1, site.re.lastIndexOf('/')), site.re.slice(site.re.lastIndexOf('/') + 1)];
    const m = new RegExp(body, flags).exec(read(site.file));
    assert.ok(m, `check-pin's pattern for ${site.file} no longer matches - the gate would stop checking it`);
    assert.match(m[1], /^\d+\.\d+\.\d+$/);
  }
});

test('check-pin: a guide that documents an API newer than the pin is a problem', async (t) => {
  // The mirrored half of AGENTS.md and the pin move independently; the
  // template once sat at 1.145.0 while its guide described z2ui5_cl_ui5_llm
  // (1.148.0). A reader following the guide got an unknown-class error.
  const { readPinSites, API_FLOORS } = await import('../check-pin.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-pin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const api = API_FLOORS[0];
  fs.writeFileSync(path.join(dir, 'abaplint.jsonc'), '{ "dependencies": [ { "branch": "1.145.0" } ] }');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `pinned to release tag \`1.145.0\`\n\n${api.symbol}=>create_claude( )\n`);
  const stale = readPinSites(dir);
  assert.ok(stale.problems.some((p) => p.includes(api.symbol) && p.includes(api.since)), stale.problems.join('\n'));

  fs.writeFileSync(path.join(dir, 'abaplint.jsonc'), `{ "dependencies": [ { "branch": "${api.since}" } ] }`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `pinned to release tag \`${api.since}\`\n\n${api.symbol}=>create_claude( )\n`);
  assert.deepEqual(readPinSites(dir).problems, []);

  // The guide is a file of its own now (the build-an-app skill's reference),
  // and AGENTS.md carries its essentials only - the check reads the guide
  // where it is, and names the file that documents the API.
  const { GUIDE_FILES } = await import('../check-pin.mjs');
  assert.ok(fs.existsSync(path.join(ROOT, GUIDE_FILES[0])), `${GUIDE_FILES[0]} is where check-pin looks for the guide, and it is not there`);
  assert.ok(read(GUIDE_FILES[0]).includes(api.symbol), 'the mirrored guide no longer names the API the floor is declared for - drop the row');
  fs.writeFileSync(path.join(dir, 'abaplint.jsonc'), '{ "dependencies": [ { "branch": "1.145.0" } ] }');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'pinned to release tag `1.145.0`\n');
  assert.deepEqual(readPinSites(dir).problems, []);
  fs.mkdirSync(path.dirname(path.join(dir, GUIDE_FILES[0])), { recursive: true });
  fs.writeFileSync(path.join(dir, GUIDE_FILES[0]), `${api.symbol}=>create_claude( )\n`);
  assert.ok(readPinSites(dir).problems.some((p) => p.startsWith(GUIDE_FILES[0]) && p.includes(api.since)));
});

test('check-pin: the three places name one release, and the gate passes', () => {
  const versions = new Set([
    /"branch":\s*"(\d+\.\d+\.\d+)"/.exec(read('abaplint.jsonc'))[1],
    /needs framework \*\*(\d+\.\d+\.\d+) or newer\*\*/.exec(read('README.md'))[1],
    /pinned to release tag `(\d+\.\d+\.\d+)`/.exec(read('AGENTS.md'))[1],
  ]);
  assert.equal(versions.size, 1, `the framework release is written differently in different places: ${[...versions]}`);
  assert.equal(run('check-pin.mjs').code, 0);
});

test('check-pin: a missing optional site is forgiven, a missing required one is not', () => {
  // A project made from this template writes its own README, and a project
  // that took only the agent setup keeps its own AGENTS.md - so check-pin has
  // to survive both prose files without the sentence. That is what makes the
  // script shippable at all. The pin itself is not optional.
  const src = read('scripts/check-pin.mjs');
  const optionalFor = (file) => new RegExp(`file: '${file}'[\\s\\S]{0,200}?optional: true`).test(src);
  assert.ok(optionalFor('README.md'), 'README.md must be optional - a project writes its own');
  assert.ok(optionalFor('AGENTS.md'), 'AGENTS.md must be optional - an agent-setup project keeps its own');
  assert.ok(!optionalFor('abaplint.jsonc'), 'abaplint.jsonc is the pin itself, so its absence is a real defect');
  assert.match(src, /if \(!found\.length\)/, 'with every site optional the gate must not pass by checking nothing');
});

test('check-pin: an optional file without the sentence is skipped; one naming another release still fails', async (t) => {
  const { readPinSites } = await import(path.join(ROOT, 'scripts/check-pin.mjs'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui5-pin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(ROOT, 'abaplint.jsonc'), path.join(dir, 'abaplint.jsonc'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# my app\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# my own agent guide\n');
  let r = readPinSites(dir);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.skipped.map((s) => s.file), ['README.md', 'AGENTS.md']);

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'The framework is pinned to release tag `1.0.0`.\n');
  r = readPinSites(dir);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /disagree/);

  fs.rmSync(path.join(dir, 'abaplint.jsonc'));
  assert.match(readPinSites(dir).problems.join('\n'), /abaplint\.jsonc: gone/);
});

/* ----------------------------------------------------------- check-template */

test('check-template: passes on this repository', () => {
  const { code, out } = run('check-template.mjs');
  assert.equal(code, 0, out);
});

test('check-template: the shared set is closed under what it invokes', () => {
  const shared = new Set(SPEC.files.shared);
  for (const [name, body] of Object.entries(PKG.scripts)) {
    for (const [, target] of body.matchAll(/node\s+(scripts\/[\w./-]+)/g)) {
      assert.ok(shared.has(target), `package.json ships and its "${name}" runs ${target}, which is not shared`);
    }
  }
  for (const file of SPEC.files.shared.filter((f) => f.endsWith('.yml'))) {
    const text = read(file);
    for (const [, npmScript] of text.matchAll(/run:\s*npm run ([\w:]+)/g)) {
      assert.ok(PKG.scripts[npmScript], `${file} ships and runs "npm run ${npmScript}", undefined in the shared package.json`);
    }
    if (/run:\s*npm ci\b/.test(text)) {
      assert.ok(shared.has('package-lock.json'), `${file} ships and runs "npm ci", which needs the lockfile shipped too`);
    }
  }
});

test('check-template: the blessed class rule is one abaplint accepts', () => {
  const clas = /"clas":\s*"([^"]+)"/.exec(read('abaplint.jsonc'))[1];
  const blessed = new RegExp(SPEC.substitutions.class.rule);
  const linted = new RegExp(clas, 'i');
  for (const probe of ['zcl_app_001', 'zcx_app_001', 'ycl_app_001', 'ycx_app_001']) {
    if (blessed.test(probe)) assert.ok(linted.test(probe), `rename would accept "${probe}" and npm run check would then reject it`);
  }
  assert.ok(blessed.test('zcl_my_app'), 'the canonical name has to stay valid');
});

test('check-template: every substitution target is a file somebody receives', () => {
  const handed = new Set([...SPEC.files.shared, ...SPEC.files.named]);
  for (const file of SPEC.substitutions.class.files) {
    assert.ok(handed.has(file), `substitutions.class names ${file}, which is not handed out`);
  }
});

test('check-template: scripts/ is walked, not exempted', () => {
  const src = read('scripts/check-template.mjs');
  assert.ok(!/rel\.startsWith\('scripts\/'\)/.test(src),
    'the blanket scripts/ exemption is how a shared package.json could name an unshipped script');
});

/* ---------------------------------------------------------- generate-agents */

test('generate-agents: the guide file and the essentials are in sync, or the guide is unreachable', () => {
  const { code, out } = run('generate-agents.mjs', ['--check']);
  // The generator is documented to pass and say so when it cannot reach the
  // guide; a real drift is a failure.
  assert.equal(code, 0, out);
  assert.match(out, /OK|SKIPPED/);
});

test('generate-agents: AGENTS.md carries the two marker lines, and nothing of the guide outside them', async () => {
  const shared = await import('../app-guide-deviations.mjs');
  const agents = read('AGENTS.md');
  const block = shared.essentialsBlock(agents);
  assert.ok(block.length > 2000, 'the essentials block is all but empty');
  // the full guide is ONE file, and AGENTS.md says where
  assert.ok(block.includes(shared.TEMPLATE_GUIDE_FILE));
  assert.ok(SPEC.files.shared.includes(shared.TEMPLATE_GUIDE_FILE), 'the guide file has to be handed out');
  const guide = read(shared.TEMPLATE_GUIDE_FILE);
  assert.match(guide, /^## 1\. The model in one paragraph$/m, 'the guide file lost the heading abap2UI5\'s check:shared cuts it at');
  assert.doesNotMatch(agents, /^## 1\. The model in one paragraph$/m, 'AGENTS.md carries the whole guide again - a second copy');
  assert.match(guide, /^<!-- GENERATED by scripts\/generate-agents\.mjs /);
  // what the whole exercise is for: an agent reads AGENTS.md before anything else
  assert.ok(Buffer.byteLength(agents) < 16000, `AGENTS.md is ${Buffer.byteLength(agents)} bytes - the part an agent pays for up front is growing back`);
  // every passage in the block is a passage of the guide, word for word
  for (const [id, text] of shared.guideEssentials(guide)) assert.ok(block.includes(text), `the essentials do not carry the marked passage "${id}" as the guide has it`);
});

test('generate-agents: the essentials are extracted by marker, and a broken marker fails', async () => {
  const { guideEssentials, renderEssentials, guideSections } = await import('../app-guide-deviations.mjs');
  const text = ['## 1. One', '', '<!-- essentials:a -->', 'first', 'passage', '<!-- /essentials:a -->', '', '```', '## 9. not a heading', '```', '### Part', '- x', '  <!-- essentials:b -->', '- second', '  <!-- /essentials:b -->'].join('\n');
  assert.deepEqual([...guideEssentials(text)], [['a', 'first\npassage'], ['b', '- second']]);
  assert.deepEqual(guideSections(text), [{ n: 1, title: 'One', parts: ['Part'] }]);
  assert.throws(() => guideEssentials('<!-- essentials:a -->\nx'), /never closed/);
  assert.throws(() => guideEssentials('<!-- essentials:a -->\n<!-- essentials:b -->'), /opens inside/);
  assert.throws(() => guideEssentials('<!-- /essentials:a -->'), /closes nothing/);
  assert.throws(() => guideEssentials('<!-- essentials:a -->\n<!-- /essentials:a -->\n<!-- essentials:a -->\n<!-- /essentials:a -->'), /twice/);
  // a passage the layout needs and the guide no longer marks, and one it marks and the layout does not place
  assert.throws(() => renderEssentials(text), /no longer marks|does not place/);
});

test('generate-agents: the generated block is replaced in place, and only between the markers', async () => {
  const { replaceEssentials, renderGuideFile } = await import('../generate-agents.mjs');
  const { ESSENTIALS_BEGIN, ESSENTIALS_END } = await import('../app-guide-deviations.mjs');
  const mine = `# mine\n\nmy rules\n\n${ESSENTIALS_BEGIN}\n\nold\n\n${ESSENTIALS_END}\n\nmy footer\n`;
  assert.equal(replaceEssentials(mine, 'NEW'), `# mine\n\nmy rules\n\n${ESSENTIALS_BEGIN}\n\nNEW\n\n${ESSENTIALS_END}\n\nmy footer\n`);
  assert.throws(() => replaceEssentials('# no markers\n', 'NEW'), /guide-essentials/);
  const file = renderGuideFile('## 1. The model in one paragraph\n\nbody\n\n');
  assert.match(file, /reads: "/, 'the header lists the declared deviations');
  assert.ok(file.endsWith('## 1. The model in one paragraph\n\nbody\n'));
});

/* ---------------------------------------------------------- generate-skills */

test('generate-skills: the copies are in sync, or the framework is unreachable', () => {
  const { code, out } = run('generate-skills.mjs', ['--check']);
  assert.equal(code, 0, out);
});

test('generate-skills: every skill ships split - a short SKILL.md and the references it names', async () => {
  const { SKILLS, SKILL_DEVIATIONS, GUIDE_REFERENCE, referencesOf } = await import('../generate-skills.mjs');
  assert.equal(SKILLS.length, 4, 'expected four skills declared');
  for (const rel of Object.keys(SKILL_DEVIATIONS)) assert.ok(fs.existsSync(path.join(ROOT, '.claude/skills', rel)), `SKILL_DEVIATIONS names ${rel}, which is not here`);
  for (const name of SKILLS) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    assert.ok(SPEC.files.shared.includes(rel), `${rel} has to be handed out - it is in files.shared`);
    const text = read(rel);
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`), `${rel}: the frontmatter name is not the directory name`);
    const afterFrontmatter = text.slice(text.indexOf('\n---\n') + 5);
    assert.match(afterFrontmatter, /^<!-- GENERATED by scripts\/generate-skills\.mjs /, `${rel}: the provenance line is missing after the frontmatter`);
    // a skill is loaded whole: the monoliths were 150 KB and 44 KB
    assert.ok(Buffer.byteLength(text) < 16000, `${rel} is ${Buffer.byteLength(text)} bytes - a long section belongs under references/`);
    for (const ref of referencesOf(text)) {
      const file = `.claude/skills/${name}/references/${ref}`;
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${rel} names references/${ref}, which is not here`);
      assert.ok(SPEC.files.shared.includes(file), `${file} is not in files.shared - a project would get a SKILL.md pointing at nothing`);
      assert.ok(SPEC.agentSetup.files[file], `${file} is not in agentSetup.files`);
      if (`${name}/references/${ref}` !== GUIDE_REFERENCE) assert.match(read(file), /^<!-- GENERATED by scripts\/generate-skills\.mjs /);
    }
  }
  // every file under .claude/skills/ is listed - nothing there a project does not get
  const here = fs.readdirSync(path.join(ROOT, '.claude/skills'), { recursive: true }).map((f) => `.claude/skills/${String(f).split(path.sep).join('/')}`).filter((f) => f.endsWith('.md'));
  assert.deepEqual(here.filter((f) => !SPEC.files.shared.includes(f)), []);
  // the reworded commands are the project's, not the framework's
  assert.ok(!read('.claude/skills/view-chain-layout/SKILL.md').includes('Run `npm run fmt:chains`.'));
  // the skill points at the guide where it is in a project
  assert.ok(referencesOf(read('.claude/skills/build-an-app/SKILL.md')).includes('building-apps.md'));
});

test('generate-skills: a file is rendered with its provenance line and deviations, and template.json follows the file list', async () => {
  const { renderFile, syncSpec, generatedLine, referencesOf } = await import('../generate-skills.mjs');
  const upstream = '---\nname: x\n---\n<!-- GENERATED by .github/scripts/generate-plugin.mjs from a in abap2UI5/abap2UI5 - x. -->\n\n# T\n\nRun `npm run fmt:chains`. Do not re-indent by hand\nsee references/b.md and `references/a.md`\n\n';
  const out = renderFile('view-chain-layout/SKILL.md', upstream);
  assert.equal(out, `---\nname: x\n---\n${generatedLine('view-chain-layout/SKILL.md')}\n\n# T\n\nRun \`npm run fix\`. Do not re-indent by hand\nsee references/b.md and \`references/a.md\`\n`);
  assert.deepEqual(referencesOf(upstream), ['a.md', 'b.md']);
  assert.throws(() => renderFile('view-chain-layout/SKILL.md', '---\nname: x\n---\nno such sentence\n'), /declared deviation/);
  assert.throws(() => renderFile('x/SKILL.md', '# no frontmatter\n'), /frontmatter/);
  assert.match(renderFile('x/references/a.md', '<!-- GENERATED by .github/scripts/generate-plugin.mjs from a -->\n\n## 1. A\n'), /^<!-- GENERATED by scripts\/generate-skills\.mjs [^\n]*\n\n## 1\. A\n$/);

  const spec = JSON.stringify({ files: { shared: ['a', '.claude/skills/x/SKILL.md', '.claude/skills/gone/SKILL.md', 'b'] }, agentSetup: { files: { a: 'ra', '.claude/skills/x/SKILL.md': 'old', b: 'rb' } } }, null, 2);
  const next = JSON.parse(syncSpec(`${spec}\n`, ['.claude/skills/abap-check/SKILL.md', '.claude/skills/abap-check/references/1.md']));
  assert.deepEqual(next.files.shared, ['a', '.claude/skills/abap-check/SKILL.md', '.claude/skills/abap-check/references/1.md', 'b']);
  assert.deepEqual(Object.keys(next.agentSetup.files), ['a', '.claude/skills/abap-check/SKILL.md', '.claude/skills/abap-check/references/1.md', 'b']);
  assert.ok(Object.entries(next.agentSetup.files).filter(([f]) => f.startsWith('.claude/')).every(([, r]) => typeof r === 'string' && r.length > 10), 'a generated entry needs its reason');
  assert.equal(next.agentSetup.files.a, 'ra');
  // the real file is already what a run would write
  assert.equal(syncSpec(read('template.json'), SPEC.files.shared.filter((f) => f.startsWith('.claude/skills/'))), read('template.json'));
});

/* ------------------------------------------------------------------ rename */

test('rename: --dry renames class, sidecar, test include and package text without writing', () => {
  const before = read('src/zcl_app_001.clas.abap');
  const { code, out } = run('rename.mjs', ['--class', 'zcl_probe_app', '--package', 'Probe', '--dry']);
  assert.equal(code, 0, out);
  assert.match(out, /zcl_probe_app/);
  assert.match(out, /src\/zcl_app_001\.clas\.testclasses\.abap  ->  src\/zcl_probe_app\.clas\.testclasses\.abap/);
  assert.equal(read('src/zcl_app_001.clas.abap'), before, '--dry must not write');
  assert.ok(fs.existsSync(path.join(ROOT, 'src/zcl_app_001.clas.abap')), '--dry must not move files');
});

test('rename: rejects a name its own lint would reject', () => {
  for (const bad of ['ycl_my_app', 'my_app', 'zcl_' + 'x'.repeat(40)]) {
    const { code } = run('rename.mjs', ['--class', bad, '--dry']);
    assert.equal(code, 2, `"${bad}" should have been refused`);
  }
});

test('rename: the placeholder it renames is the class actually in the repository', () => {
  const cls = SPEC.placeholderClass;
  for (const ext of ['clas.abap', 'clas.xml']) {
    assert.ok(fs.existsSync(path.join(ROOT, `src/${cls}.${ext}`)), `src/${cls}.${ext} is missing`);
  }
});
