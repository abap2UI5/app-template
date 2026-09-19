#!/usr/bin/env node
/*
 * sync-create — create/substitute.mjs is a COPY, and this is what keeps it one.
 *
 * `scripts/lib/substitute.mjs` holds the substitutions template.json can ask
 * for, and both `scripts/rename.mjs` and the published `create-abap2ui5-app`
 * package (`create/`) execute them. The package has to be self-contained on
 * npm - a published tarball cannot reach up into `scripts/lib` - so it carries
 * its own `substitute.mjs`. Two files, one content; this script writes the
 * copy from the original and `--check` fails when they differ, the way
 * generate-agents.mjs holds the mirrored half of AGENTS.md.
 *
 *   node scripts/sync-create.mjs           copy scripts/lib/substitute.mjs to create/
 *   node scripts/sync-create.mjs --check   fail if the copy differs (CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'scripts/lib/substitute.mjs';
const COPY = 'create/substitute.mjs';
const CHECK = process.argv.includes('--check');

const source = fs.readFileSync(path.join(ROOT, SOURCE));
const copy = fs.existsSync(path.join(ROOT, COPY)) ? fs.readFileSync(path.join(ROOT, COPY)) : null;

if (copy && copy.equals(source)) {
  console.log(`sync-create: ${COPY} is byte-equal to ${SOURCE} - OK`);
  process.exit(0);
}
if (CHECK) {
  console.error(`sync-create: ${COPY} ${copy ? 'differs from' : 'is missing;'} ${SOURCE}`);
  console.error('  The create package ships a COPY of the substitution code. Edit scripts/lib/substitute.mjs,');
  console.error('  then run `node scripts/sync-create.mjs` and commit both.');
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, COPY), source);
console.log(`sync-create: ${COPY} written from ${SOURCE}`);
