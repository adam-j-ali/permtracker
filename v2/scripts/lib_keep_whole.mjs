/**
 * Hand-typed page text that names a program or form (H-1B, CW-1, I-140, ETA-9089) and isn't kept whole: the
 * finder behind the keep-whole codemod (scripts/keep_whole_codemod.mjs) and its source gate
 * (src/app/__tests__/program-names-kept-whole.test.ts). A browser may break a line after any hyphen, so such a
 * name goes in KeepWhole (src/components/ui/keep-whole.tsx), which puts it in a no-wrap span. The pattern is
 * src/lib/programNames.json's, the one KeepWhole, the articles' plugin and the phone sweep read.
 *
 * What counts as hand-typed text: a JSX text node, and a string or template literal written as a JSX child
 * (`{"..."}`, `{`...`}`). Props are left alone (an aria-label or an alt is read out whole, never drawn across
 * lines), and so is text inside an element that shows it exactly as written (code, pre) or can't hold a span
 * (option, title, textarea, anything in an SVG).
 *
 * The codemod's rewrite renders exactly what the source rendered: JSX's own whitespace rule turns a text node
 * into a string (each line trimmed, the lines joined with one space, a space at the start kept only on the
 * first line and one at the end only on the last, entities decoded), and that string is what goes in
 * `<KeepWhole>{"..."}</KeepWhole>`, so nothing glues and nothing gains a space.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import programNames from "../src/lib/programNames.json" with { type: "json" };

export const PROGRAM_NAME_SOURCE = programNames.source;

/**
 * Elements whose text is shown exactly as written, or that can't hold a span: code and preformatted text keep
 * their own breaks, an option, a title or a textarea shows text only, and an SVG's text is drawn, not set in
 * lines (a drawing's own `<text>` may sit in a component apart from its `<svg>`).
 */
export const AS_WRITTEN = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "textarea",
  "option",
  "optgroup",
  "title",
  "script",
  "style",
  "svg",
  "text",
  "tspan",
  "textPath",
  "desc",
]);

/** The component that keeps names whole: text already inside it is done. */
const KEEP_WHOLE = "KeepWhole";

/**
 * Source files whose JSX isn't page text set in lines by the site's styles, with the reason. A folder ends in /.
 * - Email: a mail client gets inline styles, not the site's classes, so the no-wrap class does nothing there.
 * - A social card: drawn to an image by next/og, which lays out its own boxes and reads no classes.
 * - KeepWhole itself.
 */
export const NOT_PAGE_TEXT = {
  "src/emails/": "email: inline styles, never the site's classes",
  "src/components/ui/keep-whole.tsx": "the rule itself",
};

/** A file drawn to an image (a social card) by next/og: its JSX is a picture, not lines of text. */
export function drawnToImage(source) {
  return /from\s+["'](?:next\/og|@vercel\/og)["']/.test(source) || /\bImageResponse\b/.test(source);
}

/**
 * Runs left loose on purpose, each with its reason: `{ "<file>": { "<the run's text, from its start>": reason } }`.
 * The gate fails on one that's no longer found, so the list can't go stale.
 */
export const LEFT_LOOSE = {};

/** True when a run is on LEFT_LOOSE. */
export function leftLoose(file, run) {
  const own = LEFT_LOOSE[file];
  return !!own && Object.keys(own).some((start) => run.rendered.startsWith(start));
}

/**
 * The site's page sources under `root` (v2/): every .tsx under src/ but tests, stories, NOT_PAGE_TEXT and social
 * cards, as paths relative to root with their source.
 */
export function pageSources(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(p);
        continue;
      }
      if (!name.endsWith(".tsx") || /\.(test|stories)\.tsx$/.test(name)) continue;
      const file = relative(root, p).split("\\").join("/");
      if (Object.keys(NOT_PAGE_TEXT).some((k) => (k.endsWith("/") ? file.startsWith(k) : file === k))) continue;
      const source = readFileSync(p, "utf8");
      if (drawnToImage(source)) continue;
      out.push({ file, source });
    }
  };
  walk(join(root, "src"));
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The named entities a JSX text node may carry here; an unknown one stops the codemod rather than guess. */
const ENTITIES = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  hellip: "\u2026",
  ndash: "\u2013",
  mdash: "\u2014",
  middot: "\u00b7",
  times: "\u00d7",
  rarr: "\u2192",
  rsaquo: "\u203a",
  lsaquo: "\u2039",
  raquo: "\u00bb",
  laquo: "\u00ab",
  deg: "\u00b0",
  minus: "\u2212",
  larr: "\u2190",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  bull: "\u2022",
  thinsp: "\u2009",
  shy: "\u00ad",
  zwj: "\u200d",
  zwnj: "\u200c",
};

/** JSX's entity decoding: named, decimal and hex. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    if (!(body in ENTITIES)) throw new Error(`unknown entity ${whole}: add it to ENTITIES in scripts/lib_keep_whole.mjs`);
    return ENTITIES[body];
  });
}

/**
 * The string a JSX text node renders, by JSX's whitespace rule (Babel's cleanJSXElementLiteralChild, which SWC
 * follows): tabs read as spaces; each line but the first loses its leading spaces and each but the last its
 * trailing ones; blank lines go; the lines left are joined with one space. Entities are decoded after. Null
 * when nothing is left (a node of indentation only renders nothing).
 */
export function jsxRenderedText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let out = "";
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, " ");
    if (i !== 0) t = t.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) t = t.replace(/[ ]+$/, "");
    if (t) {
      if (i !== lastNonEmpty) t += " ";
      out += t;
    }
  });
  return out ? decodeEntities(out) : null;
}

/** A string literal for the rewrite: double quotes, and any invisible space spelled out so a reader sees it. */
export function stringLiteral(text) {
  return JSON.stringify(text).replace(/[\u00a0\u00ad\u2000-\u200f\u2028\u2029\u202f\u2060\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The longest line a rewrite writes when it starts a line of its own. */
const WIDTH = 120;

/**
 * `<KeepWhole>{"text"}</KeepWhole>` for a text node's rendered string. When it starts a line of its own (`indent`
 * is that line's indentation) and wouldn't fit on it, the string is written as pieces joined with `+`, each piece
 * ending at a space, so a paragraph reads as it did in the source. The pieces join back to the string exactly.
 */
export function keptText(text, indent = null) {
  const one = `<${KEEP_WHOLE}>{${stringLiteral(text)}}</${KEEP_WHOLE}>`;
  if (indent === null || indent.length + one.length <= WIDTH) return one;
  const room = Math.max(40, WIDTH - indent.length - 8);
  const pieces = [];
  let piece = "";
  for (const word of text.split(/(?<= )/)) {
    if (piece && stringLiteral(piece + word).length > room) {
      pieces.push(piece);
      piece = "";
    }
    piece += word;
  }
  if (piece) pieces.push(piece);
  const body = pieces.map((p, i) => `${indent}${i === 0 ? "  {" : "    "}${stringLiteral(p)}${i === pieces.length - 1 ? "}" : " +"}`);
  return `<${KEEP_WHOLE}>\n${body.join("\n")}\n${indent}</${KEEP_WHOLE}>`;
}

function hasName(text) {
  return new RegExp(PROGRAM_NAME_SOURCE).test(text);
}

function tagName(el) {
  const opening = ts.isJsxElement(el) ? el.openingElement : el;
  return opening.tagName.getText();
}

/** Why text inside this element is left as written, or null. */
function heldBy(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) {
      const name = tagName(p);
      if (name === KEEP_WHOLE) return KEEP_WHOLE;
      if (AS_WRITTEN.has(name)) return name;
    }
    // Text in a prop's own JSX (`title={<>...</>}`) is drawn like any other; a prop's string never reaches here.
  }
  return null;
}

/** The words a literal holds as written: a template's own text, without what it fills in. */
function literalWords(e) {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" ");
}

const isLiteral = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);

const CHOICE = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);

/** The literals a child expression may come out as, through `?:`, `&&`, `||`, `??` and parentheses. */
function choiceLiterals(e) {
  if (ts.isParenthesizedExpression(e)) return choiceLiterals(e.expression);
  if (ts.isConditionalExpression(e)) return [...choiceLiterals(e.whenTrue), ...choiceLiterals(e.whenFalse)];
  if (ts.isBinaryExpression(e) && CHOICE.has(e.operatorToken.kind)) return [...choiceLiterals(e.left), ...choiceLiterals(e.right)];
  return isLiteral(e) ? [e] : [];
}

/**
 * Every hand-typed run of page text with a program name in it that isn't kept whole, in source order:
 * `{ start, end, line, kind, rendered, replacement }`. `start`/`end` span what the codemod replaces, and
 * `replacement` is the source that renders `rendered` with each name kept whole. The kinds:
 * - `text`: a JSX text node, rewritten as `<KeepWhole>{"its rendered string"}</KeepWhole>`;
 * - `literal` and `template`: a string or template literal written as a child, put inside KeepWhole as it is;
 * - `choice`: a child that comes out as one of several literals (`{open ? "..." : "..."}`), passed through
 *   keepWhole(), which keeps whichever string it comes out as.
 */
export function findLooseNames(source, fileName = "file.tsx") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.text;
      const rendered = jsxRenderedText(raw);
      if (rendered !== null && hasName(rendered) && !heldBy(node)) {
        // Whitespace holding a line break renders nothing, so it stays outside, keeping the source's layout;
        // whitespace on the same line as the words is part of what renders, so it goes inside the string.
        const lead = raw.match(/^[ \t\r\n]*/)[0];
        const trail = raw.slice(lead.length).match(/[ \t\r\n]*$/)[0];
        const keepLead = /[\r\n]/.test(lead) ? lead : "";
        const keepTrail = /[\r\n]/.test(trail) ? trail : "";
        found.push({
          start: node.pos,
          end: node.end,
          line: lineOf(node.pos + lead.length),
          kind: "text",
          rendered,
          replacement: `${keepLead}${keptText(rendered, keepLead ? keepLead.split(/\r?\n/).pop() : null)}${keepTrail}`,
        });
      }
      return;
    }
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !heldBy(node)) {
      const e = node.expression;
      const code = e.getText(sf);
      if (isLiteral(e)) {
        if (hasName(literalWords(e))) {
          found.push({
            start: node.getStart(sf),
            end: node.end,
            line: lineOf(node.getStart(sf)),
            kind: ts.isTemplateExpression(e) ? "template" : "literal",
            rendered: ts.isTemplateExpression(e) ? code : e.text,
            replacement: `<${KEEP_WHOLE}>{${code}}</${KEEP_WHOLE}>`,
          });
        }
      } else if (choiceLiterals(e).some((l) => hasName(literalWords(l)))) {
        found.push({
          start: node.getStart(sf),
          end: node.end,
          line: lineOf(node.getStart(sf)),
          kind: "choice",
          rendered: code,
          replacement: `{keepWhole(${code})}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Text a page prints from data (`{row.label}`, `{`${s.label}, ${n} cases`}`) can name a program too, and no scan
 * of the source can say whether it does. This finds the children that print one of `fields` (a property by its
 * name: label, title, note) bare, or fill one into a template, so the codemod's `--fields` pass can put each
 * through keepWhole() or KeepWhole. keepWhole() hands back anything that isn't a string as it came, and a string
 * with no name in it too, so a page whose data names no program draws exactly as before.
 */
export function findDataFields(source, fileName, fields) {
  const want = new Set(fields);
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const isField = (e) => ts.isPropertyAccessExpression(e) && want.has(e.name.text);
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !heldBy(node)) {
      const e = node.expression;
      const code = e.getText(sf);
      if (isField(e)) {
        found.push({ start: e.getStart(sf), end: e.end, line: lineOf(e.getStart(sf)), kind: "field", rendered: code, replacement: `keepWhole(${code})` });
      } else if (ts.isTemplateExpression(e) && e.templateSpans.some((s) => isField(s.expression))) {
        found.push({
          start: node.getStart(sf),
          end: node.end,
          line: lineOf(node.getStart(sf)),
          kind: "field-template",
          rendered: code,
          replacement: `<${KEEP_WHOLE}>{${code}}</${KEEP_WHOLE}>`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The source with each data field `findDataFields` names kept whole, and how many changed. */
export function keepFieldsWhole(source, fileName, fields) {
  const found = findDataFields(source, fileName, fields);
  if (!found.length) return { text: source, count: 0 };
  let text = source;
  for (const f of [...found].sort((a, b) => b.start - a.start)) text = text.slice(0, f.start) + f.replacement + text.slice(f.end);
  const names = [];
  if (found.some((f) => f.kind === "field-template")) names.push(KEEP_WHOLE);
  if (found.some((f) => f.kind === "field")) names.push("keepWhole");
  return { text: withImport(text, fileName, names), count: found.length };
}

/**
 * The source with every loose name kept whole, and how many runs changed. Imports KeepWhole or keepWhole when
 * the rewrite uses one. Runs never overlap: a choice's literals sit inside its expression, which the finder
 * reports whole, and a literal child inside a choice isn't a child of an element.
 */
export function keepNamesWhole(source, fileName = "file.tsx") {
  const found = findLooseNames(source, fileName).filter((run) => !leftLoose(fileName, run));
  if (!found.length) return { text: source, count: 0 };
  let text = source;
  for (const f of [...found].sort((a, b) => b.start - a.start)) text = text.slice(0, f.start) + f.replacement + text.slice(f.end);
  const names = [];
  if (found.some((f) => f.kind !== "choice")) names.push(KEEP_WHOLE);
  if (found.some((f) => f.kind === "choice")) names.push("keepWhole");
  return { text: withImport(text, fileName, names), count: found.length };
}

const IMPORT_FROM = "@/components/ui/keep-whole";

/**
 * The file importing each of `names` from keep-whole: merged into an import it already has, or a new import
 * after its last one (or after a "use client" line in a file with none).
 */
export function withImport(text, fileName, names) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const own = imports.find((d) => ts.isStringLiteral(d.moduleSpecifier) && d.moduleSpecifier.text === IMPORT_FROM);
  const have = own?.importClause?.namedBindings && ts.isNamedImports(own.importClause.namedBindings)
    ? own.importClause.namedBindings.elements.map((el) => el.name.text)
    : [];
  const all = [...new Set([...have, ...names])].sort((a, b) => (a === KEEP_WHOLE ? -1 : b === KEEP_WHOLE ? 1 : a.localeCompare(b)));
  if (have.length && all.length === have.length) return text;
  const line = `import { ${all.join(", ")} } from "${IMPORT_FROM}";`;
  if (own) return text.slice(0, own.getStart(sf)) + line + text.slice(own.end);
  if (imports.length) {
    const last = imports[imports.length - 1];
    return `${text.slice(0, last.end)}\n${line}${text.slice(last.end)}`;
  }
  const first = sf.statements[0];
  const directive = first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) ? first : null;
  if (directive) return `${text.slice(0, directive.end)}\n\n${line}${text.slice(directive.end)}`;
  return `${line}\n\n${text}`;
}
