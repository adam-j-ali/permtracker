#!/usr/bin/env node
/**
 * Keep every hand-typed program or form name in the site's JSX whole: each JSX text node, string or template
 * child that names one (H-1B, CW-1, I-140) goes into KeepWhole, and a child that comes out as one of several
 * strings goes through keepWhole(). What a page renders doesn't change by a character: the text node's string
 * is the one JSX itself makes of it (scripts/lib_keep_whole.mjs). It ran once on Nov 24 2026 for the site-wide
 * pass. It's kept for a file brought in from elsewhere, since the source gate
 * (src/app/__tests__/program-names-kept-whole.test.ts) fails on any new loose name.
 *
 *   node scripts/keep_whole_codemod.mjs                 # list every loose name, change nothing
 *   node scripts/keep_whole_codemod.mjs --write         # rewrite them all
 *   node scripts/keep_whole_codemod.mjs --write src/components/x.tsx   # only these files
 *
 * `--fields=label,title,note` does the same for text printed from data: each child that prints one of those
 * properties bare (`{row.label}`) goes through keepWhole(), and a template that fills one in goes into KeepWhole.
 * No gate holds these, since only the data knows whether it names a program; the phone sweep finds the ones that
 * split on a page.
 *
 * Run from v2/. Then `pnpm typecheck`: a component that takes only a string as its children says so there,
 * and the run goes on LEFT_LOOSE in the lib with its reason.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findDataFields, findLooseNames, keepFieldsWhole, keepNamesWhole, leftLoose, pageSources } from "./lib_keep_whole.mjs";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const write = args.includes("--write");
const fieldsArg = args.find((a) => a.startsWith("--fields="));
const fields = fieldsArg ? fieldsArg.slice("--fields=".length).split(",").filter(Boolean) : null;
const only = args.filter((a) => !a.startsWith("--"));

const files = only.length
  ? only.map((file) => ({ file, source: readFileSync(join(ROOT, file), "utf8") }))
  : pageSources(ROOT);

let runs = 0;
let changed = 0;
for (const { file, source } of files) {
  const found = fields ? findDataFields(source, file, fields) : findLooseNames(source, file).filter((run) => !leftLoose(file, run));
  if (!found.length) continue;
  runs += found.length;
  changed++;
  for (const run of found) console.log(`${file}:${run.line} [${run.kind}] ${run.rendered.replace(/\s+/g, " ").slice(0, 100)}`);
  if (write) writeFileSync(join(ROOT, file), (fields ? keepFieldsWhole(source, file, fields) : keepNamesWhole(source, file)).text);
}
const what = fields ? "data text" : "loose name";
console.log(`${runs} ${what}${runs === 1 ? "" : "s"} in ${changed} ${changed === 1 ? "file" : "files"}${write ? ", rewritten" : ""}`);
