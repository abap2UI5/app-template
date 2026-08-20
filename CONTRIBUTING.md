_This project is open source and developed alongside other projects or during free time. Contributions are greatly appreciated!_

Check out the contribution guidelines [here.](https://abap2ui5.github.io/docs/resources/contribution.html)

## Before opening a pull request

```bash
npm ci
npx playwright install chromium   # the render gate needs a browser
npm run check                     # abaplint + the abap2UI5 linter, expect 0 issues
npm run check:pin                 # one framework release, everywhere
npm run check:template            # template.json still describes this repository
npm run check:agents              # the mirrored half of AGENTS.md matches the guide
```

The last three need no install and run in seconds — which is why CI runs them
*before* `npm ci`, so a broken pin is reported in fifteen seconds rather than
after a two-minute install.

Two other repositories hand this template out —
[mcp-server](https://github.com/abap2UI5/mcp-server)'s `scaffold_app` and the
[VS Code extension](https://github.com/abap2UI5/vscode-extension)'s "New
Project from Template" — and both read `template.json` to know what a project
takes from here. A file added to this repository belongs in that description;
`npm run check:template` fails while it does not.
