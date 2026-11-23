import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MDX_OPTIONS } from "../mdxOptions";
import { rehypeKeepProgramNames } from "../rehypeKeepProgramNames";

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
const text = (value: string): Node => ({ type: "text", value });
const el = (tagName: string, ...children: Node[]): Node => ({ type: "element", tagName, properties: {}, children });
const run = (tree: Node) => {
  rehypeKeepProgramNames()(tree);
  return tree;
};

describe("the articles' program-name plugin", () => {
  it("puts each name in a paragraph's text into a no-wrap span, and keeps the words around it", () => {
    const tree = run({ type: "root", children: [el("p", text("File the I-140 after the ETA-9089."))] });
    expect(tree.children![0]!.children).toEqual([
      text("File the "),
      { type: "element", tagName: "span", properties: { className: ["whitespace-nowrap"] }, children: [text("I-140")] },
      text(" after the "),
      { type: "element", tagName: "span", properties: { className: ["whitespace-nowrap"] }, children: [text("ETA-9089")] },
      text("."),
    ]);
  });

  it("leaves code and preformatted text exactly as written", () => {
    const code = el("code", text("H-1B"));
    const pre = el("pre", el("code", text("I-485 and I-765")));
    const tree = run({ type: "root", children: [el("p", code), pre] });
    expect(tree.children![0]!.children![0]).toEqual(el("code", text("H-1B")));
    expect(tree.children![1]).toEqual(el("pre", el("code", text("I-485 and I-765"))));
  });

  it("reaches text inside a component, and leaves a DOL case number whole", () => {
    const callout: Node = { type: "mdxJsxFlowElement", children: [el("p", text("Case G-100-24001-000002 is an H-2B case."))] };
    const tree = run({ type: "root", children: [callout] });
    const words = tree.children![0]!.children![0]!.children!;
    expect(words.map((n) => n.value ?? n.children?.[0]?.value)).toEqual(["Case G-100-24001-000002 is an ", "H-2B", " case."]);
  });

  it("runs in the articles' own MDX options, after the heading ids are made", async () => {
    const { content } = await compileMDX({
      source: "## The H-1B lottery\n\nThe CW-1 and `H-2A` programs, in ETA 9089 and I-140.\n",
      options: MDX_OPTIONS,
    });
    const html = renderToStaticMarkup(content);
    expect(html).toContain('id="the-h-1b-lottery"');
    expect(html).toContain('<span class="whitespace-nowrap">H-1B</span>');
    expect(html).toContain('The <span class="whitespace-nowrap">CW-1</span> and <code>H-2A</code> programs');
    expect(html).toContain('<span class="whitespace-nowrap">ETA 9089</span> and <span class="whitespace-nowrap">I-140</span>.');
  });
});
