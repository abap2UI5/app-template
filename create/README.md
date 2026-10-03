# create-abap2ui5-app

Start an [abap2UI5](https://github.com/abap2UI5/abap2UI5) app project from
[abap2UI5/app-template](https://github.com/abap2UI5/app-template), from the
command line:

```bash
npm create abap2ui5-app@latest my-app -- --class zcl_my_app --package "My App"
cd my-app
npm ci                          # the two gates, from the lockfile
npx playwright install chromium # once - only the render gate needs a browser
npm run check                   # abaplint + abap2UI5-linter, expect 0 issues
```

Then deploy the repository into your system with [abapGit](https://abapgit.org/)
and start the app with `<icf-endpoint>?app_start=zcl_my_app`.

Already have an abap2UI5 project? Run it with `--agent-setup` in that
project's directory instead - see
[below](#adding-the-agent-setup-to-an-existing-project).

## Options

| Option | Meaning |
| --- | --- |
| `<dir>` | The project directory. Must not exist yet, or be empty. With `--agent-setup`: an existing project's directory, default `.` |
| `--class <zcl_your_app>` | **Required.** The app class, lower case: `^zcl_` or `^zcx_`, at most 30 characters - the rule the template's `abaplint.jsonc` enforces, so the project passes its own gate on the first run |
| `--package "Your App"` | The ABAP package description abapGit shows (`CTEXT` in `src/package.devc.xml`) |
| `--repo <name>` | The repository name written to `.abapgit.xml` and `package.json`. Default: the directory's name |
| `--from <checkout>` | Read the template from a local `abap2UI5/app-template` checkout instead of fetching it from GitHub |
| `--agent-setup` | Add the template's agent setup and gates to an **existing** project instead of creating one - [below](#adding-the-agent-setup-to-an-existing-project). Takes no `--class`, `--package` or `--repo` |

There is no `--force`. A file the project already has is the project's: to
take the template's version instead, delete yours and run again.

## Adding the agent setup to an existing project

Most abap2UI5 projects did not start from the template - they are an abapGit
repository with a `src/` folder. `--agent-setup` gives such a project what
makes the template ready for an AI agent, and the two gates the agent is told
to run:

```bash
cd my-existing-project
npm create abap2ui5-app@latest -- --agent-setup   # or: -- --agent-setup path/to/project
npm install                     # both gates; writes package-lock.json - commit it
npx playwright install chromium # once - only the render gate needs a browser
npm run check                   # abaplint + abap2UI5-linter, over your classes
```

What it adds, and why each - the list is the template's
[`template.json`](https://github.com/abap2UI5/app-template/blob/main/template.json)
key `agentSetup`, read at run time, so it grows without a release of this
package:

| File | Why |
| --- | --- |
| `AGENTS.md` | The app-building reference an agent reads before writing an app class. Its first section ("This repository") describes a project made from the template - rewrite it for yours, keep the rest |
| `CLAUDE.md` | Points Claude Code at `AGENTS.md` |
| `.claude/settings.json` | The permission allowlist, so an agent runs the gates without a prompt for each |
| `.claude/skills/*/SKILL.md` | The framework's four skills: `build-an-app`, `view-chain-layout`, `abap-check`, `ui5-check` |
| `.mcp.json` | The abap2UI5 MCP server, registered for Claude Code |
| `abaplint.jsonc`, `abap2ui5lint.jsonc` | The two gates' configs, the framework pinned for dependency resolution |
| `package.json` | **Merged**: the gates as devDependencies, the `npm run check*` scripts, `engines` |
| `.gitignore` | **Merged**: `node_modules/` and `.playwright/` |
| `.github/workflows/check.yml` | CI: both gates and the ABAP Unit job on every pull request |
| `scripts/check-pin.mjs`, `scripts/doctor.mjs` | `npm run check:pin` (check.yml's first step) and `npm run doctor` |
| `.nvmrc` | The Node line the gates need |

What it never does:

- **touch your classes.** Nothing under your source folder, nor
  `.abapgit.xml`, is written.
- **overwrite a file.** One you already have - your own `AGENTS.md`, a
  `.claude/settings.json`, a `check.yml` - is skipped, and the output names it.
- **change a value in `package.json` or `.gitignore`.** A script,
  devDependency or `engines` entry you lack is added; one you have keeps its
  value, and the output names every one that differs from the template's. A
  package you list under `dependencies` counts as present. Without a
  `package.json` you get a new one under your directory's name.

It reads `STARTING_FOLDER` from your `.abapgit.xml`: with `/abap/src/`, the
gates check `abap/src/` - `abaplint.jsonc`'s `global.files`,
`abap2ui5lint.jsonc`'s `paths`, the unit job in `check.yml` and the
`test:unit` script are pointed there.

Left out on purpose: `package-lock.json` (it locks the template's
`package.json`, not your merged one - `npm install` writes the right one),
`.gitattributes` (renormalises line endings across your whole repository),
`.github/dependabot.yml` (your update policy is yours), `.devcontainer/` and
`.vscode/` (editor setup, not agent or gate setup).

Running it twice changes nothing. It also tells you when something will
not work as it stands - an `abaplint.json` next to the new `abaplint.jsonc`,
a source folder that does not exist, an `abaplint.jsonc` of yours that pins
no framework release (`npm run check:pin` fails on that).

Only want the agent knowledge, without the gates? In Claude Code the
framework's plugin brings the four skills and the MCP server to any project:

```text
/plugin marketplace add abap2UI5/abap2UI5
/plugin install abap2ui5@abap2ui5
```

## What it does

Without `--agent-setup`, it is the same project the other three ways produce - **Use this template** on
GitHub followed by `node scripts/rename.mjs`, the VS Code extension's *New
Project from Template*, and the MCP server's `scaffold_app` - because all four
execute the same description: the template's
[`template.json`](https://github.com/abap2UI5/app-template/blob/main/template.json)
says which files a project gets and which text in them carries a name.

This package carries no list of its own. At run time it fetches
`template.json` and every file it names from the template's `main` branch,
applies the substitutions (the class in both spellings, the package text, the
repository name) and writes the result - as bytes, so the UTF-8 BOM abapGit
expects on every `.xml` sidecar survives. The substitution code is a copy of
the template's `scripts/lib/substitute.mjs`, held byte-equal by the template's
own CI.

No dependencies; needs Node 22 or newer.
