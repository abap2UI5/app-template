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

## Options

| Option | Meaning |
| --- | --- |
| `<dir>` | The project directory. Must not exist yet, or be empty |
| `--class <zcl_your_app>` | **Required.** The app class, lower case: `^zcl_` or `^zcx_`, at most 30 characters - the rule the template's `abaplint.jsonc` enforces, so the project passes its own gate on the first run |
| `--package "Your App"` | The ABAP package description abapGit shows (`CTEXT` in `src/package.devc.xml`) |
| `--repo <name>` | The repository name written to `.abapgit.xml` and `package.json`. Default: the directory's name |
| `--from <checkout>` | Read the template from a local `abap2UI5/app-template` checkout instead of fetching it from GitHub |

## What it does

It is the same project the other three ways produce - **Use this template** on
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
