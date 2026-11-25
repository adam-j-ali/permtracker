import { describe, expect, it } from "vitest";

import { SOURCE_VIEWS, sourceViewFrom, withSourceView } from "@/lib/sourceView";

/** The sources switch's views (D3): all, or one kind, shared by ?source= with the page's other parameters kept. */
describe("sourceView", () => {
  it("names each view by the kind it shows", () => {
    expect(SOURCE_VIEWS.map((v) => [v.id, v.kind])).toEqual([
      ["all", null],
      ["agency", "official"],
      ["ours", "measured"],
      ["people", "community"],
    ]);
  });

  it("reads the view from the address, and anything else as all", () => {
    expect(sourceViewFrom("?source=agency")).toBe("agency");
    expect(sourceViewFrom("?q=nurse&source=people")).toBe("people");
    expect(sourceViewFrom("")).toBe("all");
    expect(sourceViewFrom("?source=everything")).toBe("all");
  });

  it("writes the view into the address, keeping other parameters, and drops it for all", () => {
    expect(withSourceView("", "ours")).toBe("?source=ours");
    expect(withSourceView("?q=nurse", "agency")).toBe("?q=nurse&source=agency");
    expect(withSourceView("?q=nurse&source=agency", "all")).toBe("?q=nurse");
    expect(withSourceView("?source=agency", "all")).toBe("");
  });
});
