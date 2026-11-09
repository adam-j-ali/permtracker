import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilingWindowIndicator } from "../FilingWindowIndicator";

/** A window is open through its close date: that day is the last day to file, never "closed". */
const base = { opensOn: "2026-05-01", closesOn: "2026-10-28", isRecruitmentComplete: true };

describe("FilingWindowIndicator", () => {
  it("reads the close date of an open window as the last day to file", () => {
    render(<FilingWindowIndicator label="ETA 9089 filing window" window={{ ...base, isOpen: true, daysRemaining: 0 }} />);
    expect(screen.getByText("Today is the last day to file")).toBeInTheDocument();
    expect(screen.queryByText("Window has closed")).not.toBeInTheDocument();
  });

  it("reads closed once the close date has passed", () => {
    render(<FilingWindowIndicator label="ETA 9089 filing window" window={{ ...base, isOpen: false, daysRemaining: -1 }} />);
    expect(screen.getByText("Window has closed")).toBeInTheDocument();
  });

  it("reads closed on the close date when the window isn't open", () => {
    render(<FilingWindowIndicator label="ETA 9089 filing window" window={{ ...base, isOpen: false, daysRemaining: 0 }} />);
    expect(screen.getByText("Window has closed")).toBeInTheDocument();
  });

  it("counts the days left before the last day", () => {
    render(<FilingWindowIndicator label="ETA 9089 filing window" window={{ ...base, isOpen: true, daysRemaining: 3 }} />);
    expect(screen.getByText(/days remaining/)).toHaveTextContent("3 days remaining");
    expect(screen.queryByText("Today is the last day to file")).not.toBeInTheDocument();
  });
});
