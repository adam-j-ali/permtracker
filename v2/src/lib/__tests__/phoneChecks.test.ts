import { afterEach, describe, expect, it, vi } from "vitest";

import { PROGRAM_NAME_SOURCE as SITE_SOURCE } from "@/lib/programNames";
import { PROGRAM_NAME_SOURCE, pastTheEdge, splitNames } from "../../../scripts/lib_phone_checks.mjs";

/**
 * The phone sweep's two page checks (scripts/lib_phone_checks.mjs), with the layout a browser would give
 * stubbed in: happy-dom draws nothing, so each box and each run of text is placed by hand. What these hold is
 * the judgement (which spill counts, what a split is); the probe page, scripts/fixtures/phone_sweep_probe.html,
 * holds the measuring in a real browser.
 */

type Box = { left?: number; right: number; top?: number; width?: number; height?: number };
const place = (el: Element, b: Box) => {
  const r = { left: b.left ?? 0, right: b.right, top: b.top ?? 0, width: b.width ?? b.right - (b.left ?? 0), height: b.height ?? 20 };
  (el as HTMLElement).getBoundingClientRect = () => ({ ...r, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect;
};
const $ = (sel: string) => document.querySelector(sel)!;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the sweep's program names", () => {
  it("are the site's own pattern, read from the one file", () => {
    expect(PROGRAM_NAME_SOURCE).toBe(SITE_SOURCE);
  });
});

describe("pastTheEdge", () => {
  it("names a chip that runs past a 390px screen, by its outermost box and its words", () => {
    document.body.innerHTML =
      '<main><ul class="flex"><li id="chip"><a class="inline-flex"><span class="truncate">Software Developers, Applications and Systems</span></a></li></ul></main>';
    place($("ul"), { right: 374 });
    place($("#chip"), { right: 560 });
    place($("a"), { right: 560 });
    place($("span"), { right: 540 });
    expect(pastTheEdge(390)).toEqual(['li. right=560 "Software Developers, Applications and Sy"']);
  });

  it("leaves what a scroller or a clipping box holds, the phone menu, and anything hidden from readers", () => {
    document.body.innerHTML = [
      '<main><div id="scroll" style="overflow-x: auto"><table id="wide"><tr><td>wide table</td></tr></table></div>',
      '<div id="clip" style="overflow: hidden"><a id="row">a truncated row</a></div>',
      '<nav class="fixed"><a id="drawer">menu</a></nav>',
      '<span id="deco" aria-hidden="true">decoration</span>',
      '<p id="fits">fits</p></main>',
    ].join("");
    place($("#scroll"), { right: 374 });
    place($("#wide"), { right: 900 });
    place($("#clip"), { right: 374 });
    place($("#row"), { right: 700 });
    place($("#drawer"), { left: 400, right: 700 });
    place($("#deco"), { right: 600 });
    place($("#fits"), { right: 374 });
    expect(pastTheEdge(390)).toEqual([]);
  });

  it("would still name a spill that sits beside a held one", () => {
    document.body.innerHTML = '<main><div style="overflow-x: auto"><table id="wide"></table></div><p id="long">a long word</p></main>';
    place($("div"), { right: 374 });
    place($("#wide"), { right: 900 });
    place($("#long"), { right: 410 });
    expect(pastTheEdge(390)).toEqual(['p. right=410 "a long word"']);
  });
});

describe("splitNames", () => {
  /** Draw each name's range on the given number of lines; every other range on one. */
  const lay = (linesFor: Record<string, number>) =>
    vi.spyOn(document, "createRange").mockImplementation(() => {
      let node: Node | null = null;
      let from = 0;
      let to = 0;
      return {
        setStart: (n: Node, at: number) => ((node = n), (from = at)),
        setEnd: (_n: Node, at: number) => (to = at),
        getClientRects: () => {
          const word = (node?.textContent ?? "").slice(from, to);
          return Array.from({ length: linesFor[word] ?? 1 }, (_, i) => ({ top: 100 + i * 24, height: 20, width: 30 }));
        },
      } as unknown as Range;
    });

  it("names a program name drawn across two lines, and where it sits", () => {
    document.body.innerHTML = '<main><p class="mt-1">Case by case, in every program: H-1B, H-2A, H-2B and CW-1.</p></main>';
    lay({ "CW-1": 2 });
    expect(splitNames(PROGRAM_NAME_SOURCE)).toEqual(["CW-1 in p.mt-1"]);
  });

  it("passes names each drawn on one line, and two rects on the same line are one line", () => {
    document.body.innerHTML = "<main><p>File the I-140 after the ETA-9089.</p></main>";
    vi.spyOn(document, "createRange").mockImplementation(
      () =>
        ({
          setStart: () => {},
          setEnd: () => {},
          getClientRects: () => [
            { top: 100, height: 20, width: 12 },
            { top: 101, height: 20, width: 18 },
          ],
        }) as unknown as Range,
    );
    expect(splitNames(PROGRAM_NAME_SOURCE)).toEqual([]);
  });

  it("leaves code, text hidden from readers and a shut fold alone", () => {
    document.body.innerHTML = [
      "<main><code>H-1B</code><span aria-hidden=\"true\">H-2B</span>",
      "<details><summary>About CW-1</summary><p>I-485 inside</p></details></main>",
    ].join("");
    lay({ "H-1B": 2, "H-2B": 2, "CW-1": 2, "I-485": 2 });
    expect(splitNames(PROGRAM_NAME_SOURCE)).toEqual(["CW-1 in summary."]);
  });

  it("reads nothing outside <main>", () => {
    document.body.innerHTML = "<header>H-1B</header><main><p>No names.</p></main>";
    lay({ "H-1B": 2 });
    expect(splitNames(PROGRAM_NAME_SOURCE)).toEqual([]);
  });
});
