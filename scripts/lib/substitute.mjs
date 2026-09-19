/*
 * substitute — the substitutions `template.json` can ask for, executed.
 *
 * Two programs in this repository personalise the template: `scripts/rename.mjs`
 * rewrites this checkout in place, and `create/index.mjs` (the published
 * `create-abap2ui5-app` package) writes a fresh project from the files
 * `template.json` names. Both have to make exactly the same edits — the class in
 * lower AND upper case, one XML element, one JSON key — or a project started one
 * way is not the project started the other way, which is the divergence
 * `template.json` exists to rule out.
 *
 * So the edits live here, once. `rename.mjs` imports this file; the `create`
 * package has to be self-contained on npm, so it carries a byte-equal copy at
 * `create/substitute.mjs`, written by `scripts/sync-create.mjs` and gated by its
 * `--check` in the template's self-check workflow. Edit THIS file, then run the
 * sync.
 *
 * Everything here is a pure function of text: no file I/O, no process, no
 * `template.json` read. The callers decide where the text comes from and goes.
 */

/** The class, wherever it is written: the ABAP spells it lower case, the
 *  sidecar's CLSNAME upper case, and a rename that reaches only one of the two
 *  produces an object abapGit imports under one name and ABAP activates under
 *  another. Both spellings, every occurrence. */
export function applyClass(text, oldClass, newClass) {
  return text
    .split(oldClass).join(newClass)
    .split(oldClass.toUpperCase()).join(newClass.toUpperCase());
}

/** One XML element's text — `<CTEXT>abap2UI5 app</CTEXT>` — replaced in place.
 *  The first occurrence only: the sidecars carry each element once. */
export function applyElement(text, element, value) {
  return text.replace(new RegExp(`<${element}>[^<]*</${element}>`), `<${element}>${value}</${element}>`);
}

/** One top-level JSON string key — `"name": "abap2ui5-app"` — replaced in
 *  place, as text, so the file's formatting survives. */
export function applyJsonKey(text, key, value) {
  return text.replace(new RegExp(`"${key}":\\s*"[^"]*"`), `"${key}": "${value}"`);
}

/** The class is in the FILE names too: `src/zcl_app_001.clas.abap` becomes
 *  `src/zcl_my_app.clas.abap`. Only when template.json says so. */
export function substitutePath(rel, oldClass, newClass, renamesPath = true) {
  return renamesPath ? rel.split(oldClass).join(newClass) : rel;
}

/** Why a class name is refused, or null when it is fine. The rule and the
 *  length come from template.json's `substitutions.class`, so what `rename`
 *  and `create` bless is what this repository's own abaplint accepts. */
export function classNameProblem(name, classSpec) {
  if (!name) return 'no class name given';
  if (!new RegExp(classSpec.rule).test(name)) {
    return `"${name}" does not look like an ABAP class name (^zcl_ or ^zcx_, lower case, letters digits underscore)`;
  }
  if (name.length > classSpec.maxLength) {
    return `"${name}" is ${name.length} characters; ABAP allows ${classSpec.maxLength}`;
  }
  return null;
}

/**
 * The whole personalisation of one file, as template.json describes it.
 *
 * `rel` is the file's path in the template, `text` its content; the result is
 * the content a project gets under `substitutePath(rel)`. Returns the text
 * unchanged for a file no substitution names, so the caller can write bytes
 * through untouched and keep a `.clas.xml`'s BOM byte-identical.
 */
export function substituteText(rel, text, spec, { newClass, newPackage, newRepo }) {
  const subs = spec.substitutions;
  let out = text;
  if (newClass && subs.class.files.includes(rel)) {
    out = applyClass(out, spec.placeholderClass, newClass);
  }
  if (newPackage) {
    for (const t of subs.packageText) {
      if (t.file === rel) out = applyElement(out, t.element, newPackage);
    }
  }
  if (newRepo) {
    for (const t of subs.repo) {
      if (t.file !== rel) continue;
      out = t.element ? applyElement(out, t.element, newRepo) : applyJsonKey(out, t.jsonKey, newRepo);
    }
  }
  return out;
}

/** The files a substitution can touch at all - the ones the caller has to
 *  read as text. Everything else is copied as bytes. */
export function substitutedFiles(spec) {
  const subs = spec.substitutions;
  return new Set([
    ...subs.class.files,
    ...subs.packageText.map((t) => t.file),
    ...subs.repo.map((t) => t.file),
  ]);
}
