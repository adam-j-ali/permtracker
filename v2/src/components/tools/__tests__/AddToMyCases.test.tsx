import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AddToMyCases } from "../AddToMyCases";

describe("Add to my cases", () => {
  it("links a PERM case to the new-case form with its public record", () => {
    const html = renderToStaticMarkup(<AddToMyCases record={{ caseNumber: "G-100-25318-409609", employer: "FMR LLC", outcome: "CERTIFIED" }} />);
    expect(html).toContain('href="/cases/new?add=G-100-25318-409609&amp;employer=FMR+LLC&amp;outcome=CERTIFIED"');
    expect(html).toContain("Add to my cases");
  });

  it("draws nothing for a number the app doesn't track", () => {
    expect(renderToStaticMarkup(<AddToMyCases record={{ caseNumber: "I-200-26125-868956" }} />)).toBe("");
  });
});
