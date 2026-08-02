#!/usr/bin/env node
// Every src/*.clas.abap needs a .clas.xml sidecar (UTF-8 with BOM) whose
// <CLSNAME> equals the upper-cased file name. Run via: npm run check:sidecars
import { readFileSync, readdirSync } from "node:fs";

const errors = [];
for (const abap of readdirSync("src").filter((f) => f.endsWith(".clas.abap"))) {
  const base = abap.slice(0, -".abap".length); // "zcl_foo.clas"
  const xmlPath = `src/${base}.xml`;
  let xml;
  try { xml = readFileSync(xmlPath, "utf8"); }
  catch { errors.push(`src/${abap}: missing sidecar ${xmlPath}`); continue; }
  if (!xml.startsWith("\uFEFF")) errors.push(`${xmlPath}: must start with a UTF-8 BOM`);
  const clsname = /<CLSNAME>([^<]*)<\/CLSNAME>/.exec(xml)?.[1];
  const expected = base.slice(0, -".clas".length).toUpperCase();
  if (clsname !== expected) errors.push(`${xmlPath}: <CLSNAME> is "${clsname}", expected "${expected}"`);
}
if (errors.length > 0) { console.error(errors.join("\n")); process.exit(1); }
console.log("sidecar check: OK");
