// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Spark, SplitBar } from "../FigureVisual";

describe("the small picture inside a summary figure", () => {
  it("a spark line is hidden from a screen reader, since the figure's chip says it in words", () => {
    const { container } = render(<Spark values={[3, 5, 4, 8]} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M4\.0 /);
    // The newest point is the one marked.
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
  });

  it("a spark line needs two real points, or it draws nothing", () => {
    expect(render(<Spark values={[7]} />).container.querySelector("svg")).toBeNull();
    expect(render(<Spark values={[Number.NaN, 2]} />).container.querySelector("svg")).toBeNull();
  });

  it("a flat series draws a level line, never a division by zero", () => {
    const { container } = render(<Spark values={[5, 5, 5]} />);
    expect(container.querySelector("path")?.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  });

  it("a split bar is one picture named by its sentence, with a part for each share", () => {
    render(<SplitBar parts={[{ value: 90, tone: "good" }, { value: 10, tone: "wait" }]} label="10 of 100 are still waiting." />);
    const bar = screen.getByRole("img", { name: "10 of 100 are still waiting." });
    expect(bar.children).toHaveLength(2);
    expect((bar.children[0] as HTMLElement).style.flexGrow).toBe("90");
  });

  it("a split bar leaves out an empty part and draws nothing with no total", () => {
    render(<SplitBar parts={[{ value: 4, tone: "good" }, { value: 0, tone: "wait" }]} label="All four are decided." />);
    expect(screen.getByRole("img", { name: "All four are decided." }).children).toHaveLength(1);
    expect(render(<SplitBar parts={[{ value: 0, tone: "good" }]} label="Nothing yet." />).container.firstChild).toBeNull();
  });
});
