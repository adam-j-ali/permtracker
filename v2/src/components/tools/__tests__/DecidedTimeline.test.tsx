import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { DecidedTimelineRead } from "@/lib/db/decidedTimeline";

/**
 * The line under a decided case's timeline says what the employer put on the application. A headcount of 0 is the
 * employer's own answer and is printed as given; only a missing count leaves the size out.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DecidedTimeline } = await import("../DecidedTimeline");

const read = (employees: number | null, since: number | null = 2019): DecidedTimelineRead => ({
  record: {
    receivedDate: "2025-08-20",
    decisionDate: "2026-06-10",
    status: "Certified",
    jobOrderStart: "2025-05-01",
    jobOrderEnd: "2025-06-02",
    paper1: "The Boston Globe",
    ad1: "2025-05-04",
    paper2: "The Boston Globe",
    ad2: "2025-05-11",
    recrSteps: null,
    pwd: { number: "P-100-25001-000001", filed: "2024-11-01", determined: "2025-03-14", level: "II", wage: 98000, unit: "Year", expires: null },
  },
  employer: { employees, since },
});

describe("what the employer put on the application", () => {
  it("prints a headcount of 0 as the employer gave it", () => {
    // Arrange, Act
    render(<DecidedTimeline read={read(0)} />);
    // Assert
    expect(screen.getByText(/the employer gave its size as 0 employees and its founding year as 2019/)).toBeInTheDocument();
  });

  it("leaves the size out when the application gives none", () => {
    // Arrange, Act
    render(<DecidedTimeline read={read(null)} />);
    // Assert
    expect(screen.getByText(/the employer gave its founding year as 2019/)).toBeInTheDocument();
    expect(screen.queryByText(/its size as/)).toBeNull();
  });
});
