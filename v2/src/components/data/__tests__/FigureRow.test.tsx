import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Figure, FigureRow } from "@/components/data/FigureRow";

/**
 * A row of headline figures. A number is one word: five tiles beside the data rail left "$119,350" a tile narrower
 * than itself, and it was drawn as "$119,35" over "0".
 */
describe("Figure", () => {
  it("keeps a number on one line, in a tile that won't shrink below it", () => {
    render(
      <FigureRow>
        <Figure kind="measured" label="Median wage" value="$119,350" note="offered, per year" />
        <Figure kind="measured" label="Approval" value="99.8%" />
        <Figure kind="measured" label="Filings" value="1,617" />
        <Figure kind="measured" label="Median days" value="347" />
        <Figure kind="measured" label="Median wait" value="3.9 mo" />
      </FigureRow>,
    );
    for (const v of ["$119,350", "99.8%", "1,617", "347", "3.9 mo"]) {
      const value = screen.getByText(v);
      expect(value.className, v).toMatch(/\bwhitespace-nowrap\b/);
      expect(value.parentElement!.className, v).toMatch(/\bmin-w-min\b/);
      expect(value.parentElement!.className, v).not.toMatch(/\bmin-w-0\b/);
    }
  });

  it("writes its kind of source on the card, and a blend names each kind once", () => {
    // Arrange / Act
    render(
      <FigureRow>
        <Figure kind="official" label="DOL's average" value="501 days" />
        <Figure kind={["measured", "official", "measured"]} label="DOL is working" value="June 2025" />
        <Figure kind="community" label="I-485 filed to green card" value="290 days" />
      </FigureRow>,
    );
    // Assert
    const card = (text: string) => screen.getByText(text).parentElement!;
    expect(card("501 days").dataset.sourceKind).toBe("official");
    expect(card("June 2025").dataset.sourceKind).toBe("measured official");
    expect(card("290 days").dataset.sourceKind).toBe("community");
  });

  it("lets words wrap and their tile shrink, as before", () => {
    render(
      <FigureRow>
        <Figure kind="measured" label="Oldest month still open" value="January 2026" />
        <Figure kind="measured" label="Main job" value="Software Developers, Applications" />
        <Figure kind="measured" label="Linked" value={<a href="/x">166,112</a>} />
      </FigureRow>,
    );
    for (const v of ["January 2026", "Software Developers, Applications"]) {
      const value = screen.getByText(v);
      expect(value.className, v).not.toMatch(/\bwhitespace-nowrap\b/);
      expect(value.parentElement!.className, v).toMatch(/\bmin-w-0\b/);
    }
    // A value that isn't plain text is left alone too.
    expect(screen.getByRole("link", { name: "166,112" }).parentElement!.className).not.toMatch(/\bwhitespace-nowrap\b/);
  });
});
