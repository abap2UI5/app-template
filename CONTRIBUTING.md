_This project is open source and developed alongside other projects or during free time. Contributions are greatly appreciated!_

Check out the contribution guidelines [here.](https://abap2ui5.github.io/docs/resources/contribution.html)

## Before opening a pull request

```bash
npm ci
npx playwright install chromium         # the render gate needs a browser

npm run check:all                       # what a project made from this gets: the pin, then both gates

node scripts/check-template.mjs         # template.json still describes this repository
node scripts/generate-agents.mjs --check # the mirrored half of AGENTS.md matches the guide
node --test scripts/test/*.test.mjs     # the four scripts, and the claims they make about these files
```

The last three need no install and run in seconds.

**Why the split.** The first block is the project's; the second is the
template's. `package.json` and `.github/workflows/check.yml` are both handed
out, `scripts/` mostly is not — so a `check:template` npm script in the shared
`package.json`, or a step calling it in the shared `check.yml`, is a command a
generated project inherits and cannot run. That is not hypothetical: the
generated project's first push used to fail four of seven steps
(`check:pin`, `check:template`, `check:agents` on `MODULE_NOT_FOUND`, then
`npm ci` with no lockfile) before abaplint started. "Use this template" on
GitHub copies everything and hid it; `scaffold_app` and the VS Code extension —
the two paths `template.json` exists for — did not.

So the template's own gates run from `.github/workflows/template-self-check.yml`
and are invoked as `node scripts/…` rather than through the shared
`package.json`. `scripts/check-template.mjs` enforces the closure: every
`node scripts/…` a handed-out file invokes, and every `npm run …` a handed-out
workflow calls, has to be handed out with it.

## `template.json` — one description, three executors

This template is personalised in three places, and only one of them is here:

| Who | How |
| --- | --- |
| this repository | `node scripts/rename.mjs --class zcl_my_app` rewrites the files in place |
| [mcp-server](https://github.com/abap2UI5/mcp-server) | `scaffold_app` reads a checkout and hands an agent the files |
| [the VS Code extension](https://github.com/abap2UI5/vscode-extension) | "New Project from Template" writes them into a folder, from a snapshot |

The three run in different worlds — in place, in memory, through the VS Code
file API — and that is fine. What must not differ is **which files** and
**which names in them**, and that is what `template.json` is. Add a file to
this repository and it belongs in `files.shared`, `files.named` or
`files.templateOwn` (with the reason); `check-template.mjs` fails while it is
in none of them. Do not re-type the list in any of the three consumers.

A substitution target has to be a file that is actually handed out, too:
`README.md` was listed under `substitutions.class` and excluded from the
handout, so of the three executors only the in-place rename ever touched it —
a divergence with nothing saying so. That is now checked.

## The scripts

| Script | What it is for |
| --- | --- |
| `scripts/check-pin.mjs` | **Ships.** The framework release is written in `abaplint.jsonc`, `README.md` and `AGENTS.md` and no tool moves it; this fails when they disagree, and reports a newer release as a notice. `README.md` is marked optional, because a project writes its own |
| `scripts/check-template.mjs` | `template.json` has to describe this repository, and the shared set has to be closed under what it invokes |
| `scripts/generate-agents.mjs` | Writes the mirrored half of `AGENTS.md` (everything below "1. The model in one paragraph") from the framework's app-building guide, and fails when the two have parted |
| `scripts/app-guide-deviations.mjs` | The sentences the mirror is expected to say differently. **Not this repository's file**: it is abap2UI5's `.github/shared/app-guide-deviations.mjs`, copied here and held byte-equal by that repository's `npm run check:shared` |
| `scripts/rename.mjs` | `node scripts/rename.mjs --class zcl_my_app` — makes the template yours, by executing `template.json` |

All four parse files by regex, and a pattern that stops matching does not fail —
it makes its gate pass by checking nothing. `scripts/test/` is what holds them
to that; add a case there whenever you touch a pattern.
