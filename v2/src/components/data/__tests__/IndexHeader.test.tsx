import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IndexHeader } from "@/components/data/IndexHeader";

describe("IndexHeader", () => {
  it("draws a figure's direction chip only when it has one", () => {
    render(
      <IndexHeader
        title="Find a prevailing wage request"
        lede="Search by employer."
        figures={[
          { label: "Waiting at DOL now", value: "47,681", trend: { text: "1,204 fewer in 30 days", dir: "down", tone: "good" }, note: "From DOL's case-status service" },
          { label: "Decided, with the wage set", value: "886,809" },
        ]}
      />,
    );
    expect(screen.getByText("1,204 fewer in 30 days")).toBeTruthy();
    expect(screen.getByText("From DOL's case-status service")).toBeTruthy();
    // One chip in all: the second figure's card holds its label and its number, nothing else.
    const second = screen.getByText("Decided, with the wage set").parentElement!;
    expect(second.textContent?.replace(/\s+/g, " ").trim()).toBe("Decided, with the wage set 886,809");
  });

  it("draws a figure's small picture when it's given one: a split bar named by its sentence", () => {
    render(
      <IndexHeader
        title="Find a prevailing wage request"
        lede="Search by employer."
        figures={[
          {
            label: "Waiting at DOL now",
            value: "47,681",
            split: { parts: [{ value: 90, tone: "good" }, { value: 10, tone: "wait" }], label: "10 of 100 wage requests are still waiting." },
          },
          { label: "Decided, with the wage set", value: "886,809" },
        ]}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "10 of 100 wage requests are still waiting." })).toBeTruthy();
  });
});

/**
 * Beside the case box the heading's column is narrow, and a browser may end a line after any hyphen: "Find an H-2A,
 * H-2B or CW-" over "1 filing". Each form or visa code is kept whole.
 */
describe("IndexHeader's heading", () => {
  it("keeps each form or visa code on one line, and the heading's words as written", () => {
    render(<IndexHeader title="Find an H-2A, H-2B or CW-1 filing" lede="Seasonal work." />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Find an H-2A, H-2B or CW-1 filing");
    expect([...h1.querySelectorAll("span.whitespace-nowrap")].map((s) => s.textContent)).toEqual(["H-2A", "H-2B", "CW-1"]);
  });

  it("leaves a heading with no code as plain words", () => {
    render(<IndexHeader title="PERM cases, decided and pending" lede="Every case." />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.querySelector("span")).toBeNull();
    expect(h1).toHaveTextContent("PERM cases, decided and pending");
  });

  it("keeps an LCA's visa and a petition's form number whole too", () => {
    render(<IndexHeader title="Find an H-1B LCA or an I-140" lede="x" />);
    const whole = [...screen.getByRole("heading", { level: 1 }).querySelectorAll("span.whitespace-nowrap")].map((s) => s.textContent);
    expect(whole).toEqual(["H-1B", "I-140"]);
  });
});
