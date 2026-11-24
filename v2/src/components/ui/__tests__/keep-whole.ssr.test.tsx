import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KeepWhole, keepWhole } from "../keep-whole";

describe("KeepWhole on the server", () => {
  it("puts each program name in a no-wrap span and leaves the words between as they were", () => {
    const html = renderToStaticMarkup(<p><KeepWhole>Case by case, in every program: H-1B, H-2A, H-2B and CW-1.</KeepWhole></p>);
    expect(html).toBe(
      '<p><span>Case by case, in every program: <span class="whitespace-nowrap">H-1B</span>, ' +
        '<span class="whitespace-nowrap">H-2A</span>, <span class="whitespace-nowrap">H-2B</span> and ' +
        '<span class="whitespace-nowrap">CW-1</span>.</span></p>',
    );
  });

  it("keeps the text one piece, so a flex row holds it as one item, not one per run", () => {
    const html = renderToStaticMarkup(
      <p className="flex gap-1.5">
        <KeepWhole>USCIS&apos;s median for the I-140</KeepWhole>
      </p>,
    );
    expect(html).toBe(`<p class="flex gap-1.5"><span>USCIS&#x27;s median for the <span class="whitespace-nowrap">I-140</span></span></p>`);
  });

  it("keeps the plain hyphen, so find-in-page and copying see the name as typed", () => {
    const html = renderToStaticMarkup(<KeepWhole>Form ETA-9089</KeepWhole>);
    expect(html).toContain("ETA-9089");
    expect(html).not.toContain("‑");
  });

  it("draws text with no name in it unchanged", () => {
    expect(renderToStaticMarkup(<KeepWhole>Free</KeepWhole>)).toBe("Free");
  });
});

describe("keepWhole, for a shared part's text", () => {
  it("keeps a string's names whole", () => {
    expect(renderToStaticMarkup(<p>{keepWhole("Top H-1B employers")}</p>)).toBe(
      '<p><span>Top <span class="whitespace-nowrap">H-1B</span> employers</span></p>',
    );
  });

  it("draws a node its caller built, a number and nothing as they came", () => {
    expect(renderToStaticMarkup(<p>{keepWhole(<b>H-1B</b>)}</p>)).toBe("<p><b>H-1B</b></p>");
    expect(renderToStaticMarkup(<p>{keepWhole(1140)}</p>)).toBe("<p>1140</p>");
    expect(renderToStaticMarkup(<p>{keepWhole(null)}</p>)).toBe("<p></p>");
  });
});
