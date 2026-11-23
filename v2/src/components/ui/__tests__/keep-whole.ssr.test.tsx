import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KeepWhole } from "../keep-whole";

describe("KeepWhole on the server", () => {
  it("puts each program name in a no-wrap span and leaves the words between as they were", () => {
    const html = renderToStaticMarkup(<p><KeepWhole>Case by case, in every program: H-1B, H-2A, H-2B and CW-1.</KeepWhole></p>);
    expect(html).toBe(
      '<p>Case by case, in every program: <span class="whitespace-nowrap">H-1B</span>, ' +
        '<span class="whitespace-nowrap">H-2A</span>, <span class="whitespace-nowrap">H-2B</span> and ' +
        '<span class="whitespace-nowrap">CW-1</span>.</p>',
    );
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
