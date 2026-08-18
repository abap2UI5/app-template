# abap2UI5 app template

Starter repository for building [abap2UI5](https://github.com/abap2UI5/abap2UI5)
apps — UI5 applications written purely in ABAP. Comes with the validation
gates and AI-assistant setup preconfigured, so a new app project starts with
everything the abap2UI5 ecosystem has learned about developing with (and by)
AI agents.

## What you get

- **`src/zcl_app_001`** — a working starter app (input, bound table, event)
  following the canonical template of `AGENTS.md`
- **abaplint** — syntax/style checks with the abap2UI5 framework resolved as
  a dependency, no SAP system needed
- **[abap2UI5-linter](https://github.com/abap2UI5/linter)** — checks every
  built view statically (unknown/deprecated/too-new controls and members,
  binding mistakes, builder-tree defects, chain layout) and renders it
  headless with a real `XMLView.create`
- **CI** (`.github/workflows/check.yml`) running both gates on every push/PR —
  abaplint from this repo's `package-lock.json`, the view checks through the
  linter's own GitHub Action (`abap2UI5/linter`, SHA-pinned), which brings the
  UI5 runtime and the browser the render gate needs
- **`AGENTS.md`** — the complete app-building reference for AI assistants,
  plus a `.claude/settings.json` permission allowlist so autonomous sessions
  run the gates without prompts

## Quick start

1. Click **Use this template** on GitHub (or fork/clone).
2. Install the [abap2UI5 framework](https://github.com/abap2UI5/abap2UI5) in
   your system via [abapGit](https://abapgit.org/), then install this repo
   the same way. The starter app needs framework **1.143.0 or newer** — that
   is the release the local gates lint against, pinned in `abaplint.jsonc`.
3. Create an ICF endpoint for the framework's HTTP handler (see the
   [documentation](https://abap2ui5.github.io/docs/)) and open
   `<endpoint>?app_start=zcl_app_001`.
4. Make it yours (below), then build your app following `AGENTS.md`.

## Make it yours

After **Use this template** the repository is still called `app-template`: the
name is in `.abapgit.xml`, the ABAP package still says *abap2UI5 app*, and the
app is still `ZCL_APP_001`. One command changes all of it:

```bash
npm run rename -- --class zcl_my_app --package "My App" --repo my-app
```

Add `--dry` to see what it would touch first. It rewrites the class in the
ABAP **and** the `CLSNAME` in its `.clas.xml` — renaming only one of the two
gives you an object abapGit imports under one name and ABAP activates under
another, which is the mistake this exists to prevent. (`xml_consistency` in
`abaplint.jsonc` catches it either way.)

What it renames is written down in `template.json`, not in the script: the
[MCP server](https://github.com/abap2UI5/ai-mcp) and the
[VS Code extension](https://github.com/abap2UI5/vscode-extension) hand out this
same template, and they read the same file — so a project started any of the
three ways is the same project.

Three decisions the script deliberately leaves to you:

- **Your namespace.** `abaplint.jsonc` requires `^ZCL_` or `^ZCX_`, which is
  the customer namespace every system has. If you develop in a registered
  namespace (`/ACME/`) or behind a company prefix (`ZAB_`), change
  `object_naming` there first — you make this choice once and live with it for
  years.
- **The LICENSE**, which still reads *Copyright (c) 2026 abap2UI5*. It is MIT,
  so you may keep it, change the holder, or replace it entirely. It is your
  project now.
- **The ABAP package.** `src/package.devc.xml` creates one package. Whether
  that is `$TMP` or a transportable package is decided when abapGit first
  pulls the repository into your system, not here.

## Validate locally

Both gates are npm devDependencies, so CI and your machine run the same
versions:

```bash
npm ci                          # once - installs abaplint and the linter
npx playwright install chromium # once - only for the render gate

npm run check                   # both gates, expect 0 issues
npm run check:abap              # abaplint only
npm run check:abap2ui5:fast     # linter without the render gate (no browser)
npm run fix                     # apply the linter's mechanical corrections
npm run check:pin               # the framework release named in one place only
```

`check:pin` is the small gate around the one pin nothing else can move: the
framework release in `abaplint.jsonc` is a tag inside an abaplint dependency,
which Dependabot cannot read, and the same number is repeated in this README
and in `AGENTS.md`. It fails when the three disagree, and tells you (without
failing) when a newer framework release is out.

Settings (paths, UI5 floor, distribution, rule severities, fail level) live in
`abap2ui5lint.jsonc`; every rule id is documented at
[abap2ui5.github.io/linter](https://abap2ui5.github.io/linter/).

Prefer no project install? `npx @abap2ui5/linter src --no-render` runs the
static half straight from npm.

## Iterate without a SAP system

- **[VS Code extension](https://github.com/abap2UI5/vscode-extension)**
  ([Marketplace](https://marketplace.visualstudio.com/items?itemName=abap2ui5.abap2ui5),
  [Open VSX](https://open-vsx.org/extension/abap2ui5/abap2ui5)) — F9 launches
  a class in an embedded preview against a real system; the linter's findings
  arrive as editor diagnostics with quick fixes while you type, plus
  completion for the UI5 API and the class's own binding paths, a template
  gallery for new apps, and the reconstructed XML view beside the code.
- **[ai-mcp](https://github.com/abap2UI5/ai-mcp)** — MCP server giving AI
  agents the full loop: deploy the class, build the transpiled Node backend,
  run the app headless and look at a screenshot.

## Learn more

- [AGENTS.md](AGENTS.md) — the complete app-building reference (also for humans)
- [Documentation](https://abap2ui5.github.io/docs/) — the rendered docs site
- [Samples](https://github.com/abap2UI5/samples) — curated example apps
  (bindings, events, popups, navigation)
- [samples-controls](https://github.com/abap2UI5/samples-controls) — the
  official UI5 demo kit rebuilt 1:1 as gate-verified abap2UI5 apps
- [samples-stack](https://github.com/abap2UI5/samples-stack) — abap2UI5
  alongside what your system already runs: OData, Smart Controls, RAP (with and
  without draft), business events, stateful sessions and locks, AMC/APC
  WebSockets, the MIME repository, the Fiori Launchpad. Reach for it when your
  app needs data or a stack the plain framework makes no assumption about
