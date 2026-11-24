/**
 * The keep-whole codemod (scripts/lib_keep_whole.mjs): its rewrite keeps every program name whole and renders
 * the same words, character for character, as the source it replaced. "The same" is judged by two JSX compilers
 * that aren't this file's own whitespace rule: esbuild (Babel's rule, which SWC and oxc follow) and TypeScript.
 * Each snippet is compiled and rendered before and after the rewrite, and the text must match exactly, so a
 * glued word or a gained space fails here.
 */
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";
import { findDataFields, findLooseNames, jsxRenderedText, keepFieldsWhole, keepNamesWhole, withImport } from "../../../scripts/lib_keep_whole.mjs";

type Compile = (src: string) => string;

const esbuild: Compile = (src) => transformSync(src, { loader: "tsx", jsx: "transform", jsxFactory: "h", jsxFragment: "F" }).code;
const typescript: Compile = (src) =>
  ts.transpileModule(src, {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "F", target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;

const Link = ({ children }: { children?: ReactNode }) => createElement("a", { className: "link" }, children);

/** The snippet's `el`, rendered: imports dropped, the names it uses passed in. */
function render(compile: Compile, src: string, x: unknown): string {
  const code = compile(src).replace(/^import .*$/gm, "");
  const el = new Function("h", "F", "KeepWhole", "keepWhole", "Link", "x", `${code}\nreturn el;`)(
    createElement,
    Fragment,
    KeepWhole,
    keepWhole,
    Link,
    x,
  );
  return renderToStaticMarkup(el);
}

const words = (html: string) => html.replace(/<[^>]+>/g, "");

/** Before and after, under both compilers: the same words, and the names now in no-wrap spans. */
function expectSameWords(src: string, x: unknown = "x") {
  const after = keepNamesWhole(src, "page.tsx");
  expect(after.count).toBeGreaterThan(0);
  for (const compile of [esbuild, typescript]) {
    const was = render(compile, src, x);
    const now = render(compile, after.text, x);
    expect(words(now)).toBe(words(was));
    expect(now).toContain('<span class="whitespace-nowrap">');
  }
  return after.text;
}

describe("JSX's whitespace rule, as the rewrite applies it", () => {
  it("trims each line, joins the lines with one space and drops the blank ones", () => {
    expect(jsxRenderedText("\n    Top H-1B employers\n  ")).toBe("Top H-1B employers");
    expect(jsxRenderedText("\n  Line one   \n\n     line two H-1B\n  ")).toBe("Line one line two H-1B");
  });

  it("keeps a space at the start only on the first line, and at the end only on the last", () => {
    expect(jsxRenderedText(" by certified H-1B LCAs")).toBe(" by certified H-1B LCAs");
    expect(jsxRenderedText("Every H-1B ")).toBe("Every H-1B ");
    expect(jsxRenderedText(" first \n second ")).toBe(" first second ");
  });

  it("reads tabs as spaces, decodes entities, and finds nothing in indentation", () => {
    expect(jsxRenderedText("\tUSCIS&apos;s I-485&nbsp;line")).toBe(" USCIS's I-485 line");
    expect(jsxRenderedText("\n    \n  ")).toBeNull();
  });

  it("stops on an entity it doesn't know rather than guess", () => {
    expect(() => jsxRenderedText("an &unknownentity; here")).toThrow(/unknown entity/);
  });
});

describe("the rewrite renders the same words, names kept whole", () => {
  it("a paragraph over several lines beside a link and its space", () => {
    expectSameWords(`const el = (
      <p className="mt-2">
        Every wage request, PERM case, H-1B LCA and H-2A, H-2B and
        CW-1 filing, with its&nbsp;dates and DOL&apos;s answer.{" "}
        <Link>How it works</Link>
      </p>
    );`);
  });

  it("text on the same line as an element, with its leading and trailing spaces", () => {
    expectSameWords(`const el = (<p><b>{x}</b> by certified H-1B LCAs <i>since 2008</i> and the H-1B1 too</p>);`);
  });

  it("a template and a choice of strings", () => {
    expectSameWords("const el = (<p>{`I-485 at ${x}`} and {x ? \"an H-1B\" : \"none\"}</p>);");
    expectSameWords("const el = (<p>{x === 'y' ? `For ${x}, the H-1B` : null}</p>);", "y");
    expectSameWords("const el = (<p>{x && \"the CW-1 wait\"}</p>);", "yes");
  });

  it("text inside a fragment and inside a prop's own JSX", () => {
    expectSameWords(`const Card = (p: { title: unknown }) => <section>{p.title as never}</section>;
    const el = (<><Card title={<>The I-140 clock</>} /> and the ETA-9089</>);`);
  });

  it("a long paragraph, written back as pieces that each end at a space", () => {
    const out = expectSameWords(`const el = (
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        Colleges and universities, the nonprofits tied to them, and research organizations hire H-1B workers outside the
        lottery. These are the employers whose wage requests tell DOL they&apos;re one of those, and every H-2B too.
      </p>
    );`);
    const lines = out.split("\n");
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(120);
    expect(out).toContain(`        <KeepWhole>\n          {"Colleges and universities, `);
    expect(out).toMatch(/ " \+\n {12}"/);
  });

  it("keeps the source's layout: a line break around the text stays outside the rewrite", () => {
    const out = keepNamesWhole(`const el = (
  <p>
    The I-140, then the I-485
  </p>
);`).text;
    expect(out).toContain(`<p>\n    <KeepWhole>{"The I-140, then the I-485"}</KeepWhole>\n  </p>`);
  });
});

describe("what the rewrite leaves alone", () => {
  const none = (src: string) => expect(findLooseNames(src, "page.tsx")).toEqual([]);

  it("text with no program name, and a case number that only looks like one", () => {
    none(`const el = (<p>Plain words and the case G-100-24001-000002</p>);`);
  });

  it("props: an aria-label, an alt, a title", () => {
    none(`const el = (<a aria-label="Top H-1B employers" title={"The I-485"} href="/x"><img src="/chart.png" alt="An H-1B chart" /></a>);`);
  });

  it("code, preformatted text, an option, a page title, and a drawing's text", () => {
    none(`const el = (<div><code>H-1B</code><pre>{"I-485"}</pre><select><option>EB-2</option></select><title>CW-1</title>
      <svg><text>H-2A</text></svg><text>I-140</text></div>);`);
  });

  it("text already in KeepWhole, and a choice already through keepWhole", () => {
    none(`const el = (<p><KeepWhole>Top H-1B employers</KeepWhole>{keepWhole(x ? "the I-485" : null)}</p>);`);
  });

  it("a child that's data, not typed text", () => {
    none(`const el = (<p>{row.label} {labels.join(", ")}</p>);`);
  });
});

describe("the --fields pass, for text printed from data", () => {
  const FIELDS = ["label", "title"];

  /** Before and after, rendered with `x` as the data: the same words. */
  function sameWords(src: string, x: unknown) {
    const out = keepFieldsWhole(src, "page.tsx", FIELDS).text;
    for (const compile of [esbuild, typescript]) expect(words(render(compile, out, x))).toBe(words(render(compile, src, x)));
    return out;
  }

  it("puts a bare field through keepWhole and a template that fills one in into KeepWhole", () => {
    const src = "const el = (<p>{x.label} and {`${x.title}, every case`}</p>);";
    const out = sameWords(src, { label: "The H-1B LCA", title: "The I-140" });
    expect(out).toContain("{keepWhole(x.label)}");
    expect(out).toContain("<KeepWhole>{`${x.title}, every case`}</KeepWhole>");
    expect(render(esbuild, out, { label: "The H-1B LCA", title: "The I-140" })).toContain('<span class="whitespace-nowrap">H-1B</span>');
  });

  it("draws data with no name, a number and nothing exactly as before", () => {
    const src = "const el = (<p>{x.label}|{x.title}</p>);";
    for (const x of [{ label: "Plain words", title: "More" }, { label: 42, title: null }]) {
      const out = keepFieldsWhole(src, "page.tsx", FIELDS).text;
      expect(render(esbuild, out, x)).toBe(render(esbuild, src, x));
    }
  });

  it("leaves other fields, props, options and fields already kept alone", () => {
    const src = `const el = (<div title={x.title}><p>{x.name}</p><select><option>{x.label}</option></select><p>{keepWhole(x.label)}</p></div>);`;
    expect(findDataFields(src, "page.tsx", FIELDS)).toEqual([]);
  });
});

describe("the import", () => {
  it("is added after the file's last import, once, with what the rewrite uses", () => {
    const src = `"use client";\n\nimport { cn } from "@/lib/utils";\n\nexport const A = () => <p>The I-485 {x ? "H-1B" : ""}</p>;\n`;
    const out = keepNamesWhole(src, "page.tsx").text;
    expect(out).toContain(`import { cn } from "@/lib/utils";\nimport { KeepWhole, keepWhole } from "@/components/ui/keep-whole";\n`);
    expect(out.match(/keep-whole"/g)).toHaveLength(1);
  });

  it("joins an import the file already has", () => {
    const src = `import { keepWhole } from "@/components/ui/keep-whole";\n\nexport const A = () => <p>The I-485</p>;\n`;
    expect(keepNamesWhole(src, "page.tsx").text).toContain(`import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";`);
  });

  it("goes after a 'use client' line in a file with no imports", () => {
    expect(withImport(`"use client";\n\nexport const A = 1;\n`, "a.tsx", ["KeepWhole"])).toBe(
      `"use client";\n\nimport { KeepWhole } from "@/components/ui/keep-whole";\n\nexport const A = 1;\n`,
    );
  });
});
