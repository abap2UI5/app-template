# This repository, in detail

The long form of the first part of [`AGENTS.md`](../AGENTS.md): every file of
a project made from [abap2UI5/app-template](https://github.com/abap2UI5/app-template),
the gates and how they fail, the addons, testing an app without a system, and
where the agent skills come from. `AGENTS.md` says the same in a page and is
what an agent reads first; come here for the reason behind a line of it.

## This repository

| Path | Purpose |
| --- | --- |
| `src/` | The app classes (abapGit project, `STARTING_FOLDER=/src/`, `FOLDER_LOGIC=PREFIX`) — one class per app, named `ZCL_*` |
| `src/zcl_app_001.clas.abap` | The starter app — rename/copy it for your first real app (keep the `.clas.xml` sidecar's `CLSNAME` in sync) |
| `src/zcl_app_001.clas.testclasses.abap` | ABAP Unit tests for the starter app: a test double for `z2ui5_if_client` drives `main( )` through the first start, a `SAVE` event and a navigated roundtrip. Runs on the system (ADT `Ctrl+Shift+F10`); the local gates check it statically — see "Testing an app" below |
| `package.json` | The two gates as devDependencies (`@abaplint/cli`, `@abap2ui5/linter` + its render runtime `@abap2ui5/linter-render`, on the same minor line — they are cut from one tag) and the `npm run check*` scripts. `package-lock.json` is committed, so CI and your machine run the same versions |
| `package-lock.json` | Committed on purpose: `npm ci` reads it, so the gate versions CI runs are the ones you ran locally |
| `abaplint.jsonc` | abaplint config; abaplint clones the abap2UI5 framework for dependency resolution, pinned to a release tag — `AGENTS.md` names it, and `npm run check:pin` holds the places that do to one number (`"branch"` — abaplint passes it to `git clone --branch`, which takes a tag; there is no `"tag"` key). The framework floor is 1.143.0: `1.142.0` has neither `z2ui5_cl_ui5_view_builder` nor `client->get_event( )`, both of which the starter class uses. Bump the pin when you need a newer API, and run `npm run check` |
| `abap2ui5lint.jsonc` | [abap2UI5-linter](https://github.com/abap2UI5/linter) config (paths, UI5 floor, distribution, rule severities, fail level) — CLI flags override it |
| `.github/workflows/check.yml` | CI: the framework pin, then abaplint from the lockfile, then the abap2UI5-linter through its own action (`abap2UI5/linter`, SHA-pinned) for the static gate + headless render of every view |
| `scripts/check-702.mjs`, `.github/abaplint/abap_702.jsonc` | `node scripts/check-702.mjs` — does the app downport to NetWeaver 7.02? A temporary copy of `src/` downported with `abaplint --fix` against the framework's `-702` release and linted at v702; your tree is never touched |
| `.github/scripts/rename.mjs` | abap2UI5's namespace rename, for a system where the framework is installed renamed: `node .github/scripts/rename.mjs --name /CA2UI5/ --out build/renamed` writes `src/` with every `z2ui5_` reference renamed and your own `zcl_`/`zcx_`/`zif_` objects moved into the same namespace (`package.json` `config.renameOwn`); without `--name` it checks the longest name the framework allows. Not the template's `scripts/rename.mjs` |
| `scripts/check-pin.mjs` | `npm run check:pin` — the framework release above is written in more than one place and no tool moves it; this fails when they disagree and notices (without failing) when a newer release is out |
| `scripts/add-addon.mjs`, `scripts/addons.json` | `npm run add-addon -- <repo>` — registers an addon of [abap2UI5-addons](https://abap2ui5-addons.github.io/) (`popups`, `range-filter`, …) and everything it depends on in `abaplint.jsonc`, from a vendored snapshot of the addon catalogue — see "Addons" below |
| `scripts/doctor.mjs` | `npm run doctor` — offline environment check, one line per finding with its remedy: Node version, both gates installed and on one minor line, a Chromium the render gate can launch, the framework pin, the linter Action pin against the devDependency, every `.clas.xml` sidecar (BOM, LF, `CLSNAME`, `WITH_UNIT_TESTS`), `abap2ui5lint.jsonc`, an addon class the app names that `abaplint.jsonc` does not resolve, the VS Code extension, the linter's compatibility record, whether the installed linter has `--watch`. Exit 1 only on FAIL |
| `.claude/skills/` | Four agent skills mirrored from the framework — `build-an-app`, `view-chain-layout`, `abap-check`, `ui5-check` — loaded on demand by Claude Code and any agent that reads `SKILL.md` files: a short `SKILL.md` each, the long sections as files under `references/`. Generated (each file says so in its first lines); "this repository" in their text is the framework's |
| `.claude/skills/build-an-app/references/building-apps.md` | The framework's app-building guide, whole — the one copy in this repository. `AGENTS.md` carries the essentials cut out of it |
| `AGENTS.md`, `docs/project.md` | The briefing an agent reads first — this repository in short, then the guide's essentials — and this file, the long form of its first part |
| `.claude/settings.json`, `.mcp.json` | The permission allowlist for autonomous sessions, and the abap2UI5 MCP server registered for Claude Code (`npx --yes @abap2ui5/mcp-server`). The VS Code extension registers the same server for Copilot itself |
| `.devcontainer/`, `.vscode/extensions.json` | A dev container (Node 22, both gates and Chromium installed on create, the abap2UI5, abaplint and Claude Code extensions) and the editor's extension recommendations |

## Build & verify — run before every commit

```bash
npm ci                          # once - installs both gates from the lockfile
npx playwright install chromium # once - only the render gate needs a browser

npm run doctor                  # is this machine able to run the gates? one line per check, with the remedy

npm run check                   # abaplint + linter, expect 0 issues
npm run check:abap2ui5:fast     # fast loop: linter without the render gate
npm run watch                   # the fast loop, again on every save - Ctrl+C ends it
npm run watch:render            # the same with the render gate, one warm browser across the runs
npm run test:unit               # the ABAP Unit tests in the transpiled backend - no system (see Testing an app)
npm run fix                     # apply the linter's mechanical corrections
npm run check:pin               # the framework release this repo names, in one place
npm run add-addon -- popups     # an app calls an addon class: register the addon with the lint gate
npm run check:all               # everything CI runs: the pin, then both gates
npm test                        # the same as `npm run check:all`
```

When a gate fails in a way that names a symptom rather than a cause — a
syntax error inside `node_modules` (old Node), "browser not found" (no
Chromium), a rule CI has and your run does not (Action pin and devDependency
on different minor lines), "Class z2ui5_cl_popup_... not found" (an addon the
lint gate was never told about) — `npm run doctor` says which, and what to
run. It is offline and takes a second.

`npm run watch` is `abap2ui5lint --watch --no-render`: the static check once,
then again on every save under `src/` (and on an edit to
`abap2ui5lint.jsonc`, which is read again), the report on stdout and a
separator naming the changed file on stderr; `npm run watch:render` is the
same loop with the render gate on, keeping one warm browser across the runs
instead of launching one per run. A watch never exits 1 - it is the loop for
a developer whose editor has no linter in it (Eclipse ADT, with abapGit
pulling the classes into this checkout: save, pull, read), not a gate; it
refuses `--fix`, `--screenshot` and the JSON/SARIF outputs, so `npm run fix`
stays a separate step. VS Code users have the extension's live check instead.
The flag arrived with `@abap2ui5/linter` 0.7.0; on an older linter both
scripts print its `unknown option '--watch'` and exit 2 (`npm run doctor` says
whether the installed linter has it).

`npm run check:all` is the local equivalent of the CI job — a green run of it
means CI passes. (`npm run check` is the two gates alone and skips the pin,
which is why the two scripts exist separately.)

Both gates run offline from any SAP system (abaplint clones the framework on
first use, so it needs network). Deploy to a system via
[abapGit](https://abapgit.org/) and start an app with
`<icf-endpoint>?app_start=zcl_app_001`.

While writing, the
[VS Code extension](https://github.com/abap2UI5/vscode-extension) surfaces the
same linter findings as editor diagnostics with quick fixes, and
[mcp-server](https://github.com/abap2UI5/mcp-server) gives an MCP-capable agent the
deploy → build → run-headless-and-screenshot loop.

Conventions: every `.clas.abap` needs its `.clas.xml` sidecar (UTF-8 **with
BOM**, LF endings — copy an existing one; `abaplint.jsonc` enables `xml_bom`
and `xml_consistency`, so a hand-edited sidecar fails the gate rather than the
next abapGit pull; a class with a `.clas.testclasses.abap` include also
carries `<WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>` after `<UNICODE>`, which is how
abapGit serializes one); class names stay in `ZCL_*`/`ZCX_*`, which is both
`object_naming` in `abaplint.jsonc` and the rule the rename step enforces; the
whole repo is in English.

## Addons

`abaplint.jsonc` lists what abaplint clones to resolve the classes an app
calls, and out of the box that is the framework alone. A class of an addon
([abap2UI5-addons](https://abap2ui5-addons.github.io/): `z2ui5_cl_popup_to_confirm`
of popups, `z2ui5_cl_layo_manager` of layout-management, …) therefore fails
`npm run check:abap` with **"Class ... not found" — which says the gate does
not know the addon, not that the call is wrong.** `npm run doctor` names the
addon; this registers it:

```bash
npm run add-addon -- popups          # popups, and layout-management, which it needs
npm run add-addon -- --list          # every addon: what it is for, its classes, what it needs
npm run add-addon -- popups --dry    # what would change, nothing written
```

It inserts one entry per addon into `dependencies` — the addon's own
dependencies first, each once, nothing else in the file touched — and does
the same in `.github/abaplint/abap_702.jsonc`. A second run changes nothing.

**The pin.** abaplint clones a dependency with `git clone --depth 1 -b
<branch>`, and `-b` takes a branch or a tag, never a commit. So an addon that
carries a release tag equal to the framework release pinned here (today
popups, layout-management, table-maintenance and the two custom-controls
repositories, each with the tag and its `-702` twin) is pinned to that tag, and a later run moves it
along when the framework pin moved. An addon without that tag follows its
default branch (`main`, for some `standard`; `702` in the 7.02 config) and the
output and the comment in the file say **NOT pinned**: that lint can change
without a commit here. To hold such an addon at a commit, check it out
yourself at the entry's `"folder"` — abaplint reads a dependency from there
when the folder holds files and skips the clone.

**On the system an addon is a separate install.** It is a repository of its
own, pulled with abapGit after abap2UI5 and after what it depends on; the run
ends with that order. An app that calls an addon does not activate on a
system that has not pulled it — say which addons the app needs.

What the script knows is `scripts/addons.json`, a snapshot of the addon
catalogue (<https://abap2ui5-addons.github.io/addons.json>: `useWhen`,
`entryPoints`, `dependsOn`) and of each addon's branches and tags, so it works
offline and decides the same thing every time. The template refreshes it
daily; take a newer one by copying the file from the template's `main`.
`npm run test:unit` installs the framework alone — a test that reaches into
an addon class needs a system.

## Testing an app

`src/zcl_app_001.clas.testclasses.abap` shows the shape: the app talks to the
framework only through the `z2ui5_if_client` it is handed, so a local class
with `INTERFACES z2ui5_if_client PARTIALLY IMPLEMENTED` — attributes deciding
what `check_on_init( )` / `check_on_navigated( )` / `check_on_event( )` /
`get_event( )` answer, tables recording what `view_display( )` and
`message_toast_display( )` were given — is the whole test bed. The three tests
are the three roundtrips every app has: the first call seeds the model and
displays a view (`<Input`, `<List`), the `SAVE` event toasts `Saved, World`,
and a navigated roundtrip re-displays without seeding again. The double
implements every method the app CALLS - the lifecycle questions, the two
things it does back, and the four the view code reaches for (`_bind`,
`_event`, `_event_nav_app_leave`, `check_app_prev_stack`): on a system a
`PARTIALLY IMPLEMENTED` interface's missing methods are generated empty, in
the transpiled runtime below they are not, and a call to one is a TypeError
there. Add a method to the double when the app starts calling another one;
the runner names the missing one.

Run them on the system with ABAP Unit (ADT `Ctrl+Shift+F10`, or SE24) - or
**without a system**: `npm run test:unit` (the mcp-server's `abap2ui5-unit`)
installs the framework at the release `abaplint.jsonc` pins from the npm
package `@abap2ui5/node-runtime` (cached under `~/.abap2ui5-mcp`; a pin older
than 1.145.0 clones the release and builds its backend instead), transpiles
the classes under `src/` with their test includes into it and runs the tests
through the open-abap runtime. The `unit`
job in `check.yml` does the same on every pull request through the
`abap2UI5/mcp-server` action, with the step summary naming every test method
and the first failure. What the runtime cannot model (the abap-check skill
lists the known cases) a system still has to answer. `npm run check` stays
what it is: abaplint compiles the include against the framework's interface,
and the abap2UI5-linter skips `*.testclasses.abap`, so the render gate sees
the app class alone. The rename step renames the include with the class (it
is in `template.json`'s `substitutions.class.files`).

## Agent skills and the guide

`.claude/skills/` holds four skills an agent loads when the task matches
their description: **build-an-app** (the checklist for writing an app class),
**view-chain-layout** (the seven layout rules for a builder chain and the
linter rule that checks them), **abap-check** (ABAP that a green CI does not
catch: abapGit round trip, activation, extended check, runtime) and
**ui5-check** (the same for the view: names that do not exist on the oldest
supported UI5 release, layout that needs a newer one).

Each is a short `SKILL.md` — the two catalogues with a table that says which
file to read when — and its long sections as files under `references/`, so an
agent that is told to run `abap-check` reads the two sections every app needs
and not the framework's downport pipeline. The framework's guide to building
an app is one of those references,
`.claude/skills/build-an-app/references/building-apps.md`, and it is the only
copy here: `AGENTS.md` carries the passages the guide itself marks as
essential, cut out word for word between its two `guide-essentials` marker
lines, and a table of the guide's sections.

All of it is mirrored from
[abap2UI5/abap2UI5](https://github.com/abap2UI5/abap2UI5) by the template's
generators — the skills from its `skills/` folder, the guide and the
essentials from its `docs/agents/building-apps.md` — with a declared handful
of sentences reworded (`npm run fmt:chains` is `npm run fix` here; the guide
file lists its own in its header). Where a skill says "this repository" or
names a `.github/scripts/` gate, it means the framework's. Fix them upstream;
a regeneration overwrites the copies (the template regenerates its mirrors
daily and opens a pull request when abap2UI5 changed them; a project made
from it takes newer text by copying the files from the template's `main`).
Your own rules for agents go into `AGENTS.md`, outside the two marker lines.

Starting a project without this repository's own scaffolding: `npm create
abap2ui5-app@latest my-app -- --class zcl_my_app` writes the same files from
the template's `main` branch (see the template's README for the four ways).
Adding this setup to a project that did not start from the template: `npm
create abap2ui5-app@latest -- --agent-setup` in its directory writes the agent
files and the gates (`template.json`'s `agentSetup` says which), skips every
file the project already has, and only adds to `package.json` and
`.gitignore`.
