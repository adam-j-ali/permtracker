import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChapterFold } from "../ChapterFold";

/**
 * A fold's title and its hint are two blocks on screen, but its text reads as one run: without a space between them
 * the rendered audit read "Its newest filings in each programWage requests, LCAs ..." and stopped the Nov 23 2026
 * release.
 */
describe("ChapterFold", () => {
  it("keeps a space between the title and the hint in the summary's text", () => {
    const { container } = render(
      <ChapterFold summary="Its newest filings in each program" hint="Wage requests, LCAs and seasonal filings">
        <p>inside</p>
      </ChapterFold>,
    );
    const text = (container.querySelector("summary")?.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Its newest filings in each program Wage requests");
  });
});
