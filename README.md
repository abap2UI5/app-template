# abap2UI5 app template

Starter repository for building [abap2UI5](https://github.com/abap2UI5/abap2UI5)
apps — UI5 applications written purely in ABAP. Comes with the validation
gates and AI-assistant setup preconfigured, so a new app project starts with
everything the abap2UI5 ecosystem has learned about developing with (and by)
AI agents.

## What you get

- **`src/zcl_app_001`** — a working starter app (input, bound table, event)
  following the canonical template
- **abaplint** — syntax/style checks with the abap2UI5 framework resolved as
  a dependency, no SAP system needed
- **[abap2UI5-linter](https://github.com/abap2UI5/abap2UI5-linter)** — checks
  every built view statically (unknown/deprecated/too-new controls and
  members, binding mistakes, builder-tree defects) and renders it headless
  with a real `XMLView.create`
- **CI** (`.github/workflows/check.yml`) running both gates on every push/PR
- **`AGENTS.md`** — the complete app-building reference for AI assistants,
  plus a `.claude/settings.json` permission allowlist so autonomous sessions
  run the gates without prompts

## Quick start

1. Click **Use this template** on GitHub (or fork/clone).
2. Install the [abap2UI5 framework](https://github.com/abap2UI5/abap2UI5) in
   your system via [abapGit](https://abapgit.org/), then install this repo
   the same way.
3. Create an ICF endpoint for the framework's HTTP handler (see the
   [documentation](https://abap2ui5.github.io/docs/)) and open
   `<endpoint>?app_start=zcl_app_001`.
4. Build your app: copy `src/zcl_app_001.clas.abap` (+ its `.clas.xml`,
   keeping `CLSNAME` in sync), and follow `AGENTS.md`.

## Validate locally

```bash
npx --yes @abaplint/cli@latest abaplint.jsonc            # 0 issues expected
npx --yes github:abap2UI5/abap2UI5-linter                # view gates + render
npx --yes github:abap2UI5/abap2UI5-linter --no-render    # fast, no browser
# settings (paths, UI5 floor, fail level) live in abap2ui5lint.jsonc
```

## Iterate without a SAP system

- **[ai-mcp](https://github.com/abap2UI5/ai-mcp)** — MCP server giving AI
  agents the full loop: deploy the class, build the transpiled Node backend,
  run the app headless and look at a screenshot.
- **[vscode-extension](https://github.com/abap2UI5-addons/vscode-extension)**
  — F9 launches a class in an embedded preview against a real system, with
  the linter's findings as editor diagnostics.

## Learn more

- [AGENTS.md](AGENTS.md) — the complete app-building reference (also for humans)
- [Documentation](https://abap2ui5.github.io/docs/) — the rendered docs site
- [Samples](https://github.com/abap2UI5/samples) — curated example apps
- [ai-demokit](https://github.com/abap2UI5/ai-demokit) — ~280 gate-verified
  ports of the official UI5 demo kit samples
