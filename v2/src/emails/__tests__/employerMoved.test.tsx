// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";

import { EmployerMoved, mixSegments } from "../EmployerMoved";

describe("the employer alert's pending bar", () => {
  it("runs in the site's order, sums to 100 and keeps a tiny group visible", () => {
    const segs = mixSegments({ pending: 1000, queue: 990, review: 9, appeal: 1 });
    expect(segs.map((s) => s.group)).toEqual(["review", "appeal", "queue"]);
    expect(segs.reduce((a, s) => a + s.w, 0)).toBe(100);
    expect(segs.find((s) => s.group === "appeal")!.w).toBeGreaterThanOrEqual(2);
    expect(mixSegments({ pending: 0, queue: 0, review: 0, appeal: 0 })).toEqual([]);
  });

  it("names who acted and prints no reason", async () => {
    const html = await render(
      EmployerMoved({
        employerName: "Small Co",
        employerUrl: "https://permtracker.app/perm-employers/small-co",
        moves: [{ dateLabel: "Sep 25", sentence: "12 of its cases were withdrawn by the employer", tone: "neutral" }],
        mix: null,
        asOf: "September 25, 2026",
        unsubscribeUrl: "https://permtracker.app/employer-alert/unsubscribe?token=U",
      }),
    );
    expect(html).toContain("withdrawn by the employer");
    expect(html).toContain("DOL gives no reason");
    expect(html).not.toMatch(/suspend|investigat|fraud/i);
  });
});

describe("the every-case alert", () => {
  const props = {
    employerName: "Small Co",
    employerUrl: "https://permtracker.app/perm-employers/small-co",
    moves: [
      {
        dateLabel: "Nov 10",
        sentence: "DOL certified 3 of its cases",
        tone: "good" as const,
        cases: [
          { number: "A-25100-00001", url: "https://permtracker.app/perm-case-status?case=A-25100-00001", note: "Software Engineer, filed Apr 2025" },
          { number: "A-25100-00002", url: "https://permtracker.app/perm-case-status?case=A-25100-00002", note: "" },
        ],
        more: 1,
      },
    ],
    mix: null,
    asOf: "November 12, 2026",
    scope: "each" as const,
    unsubscribeUrl: "https://permtracker.app/employer-alert/unsubscribe?token=U",
  };

  it("lists each case as a link to its own page, with what DOL holds to tell them apart", async () => {
    // Act
    const html = await render(EmployerMoved(props));
    // Assert
    expect(html).toContain('href="https://permtracker.app/perm-case-status?case=A-25100-00001"');
    expect(html).toContain("Software Engineer, filed Apr 2025");
    expect(html).toContain("A-25100-00002");
    expect(html).toContain("and 1 more, listed on its page");
  });

  it("says in the footer that this is the case-by-case follow, and closes without a reason", async () => {
    const html = await render(EmployerMoved(props));
    expect(html).toContain("case by case");
    expect(html).not.toContain("five or more of its cases");
    expect(html).toContain("DOL gives no reason for any of them");
    // No pending bar was drawn, so the closing line names no census day.
    expect(html).not.toContain("counted on");
  });

  it("leaves a group follower's email exactly as it was", async () => {
    const html = await render(EmployerMoved({ ...props, scope: undefined, moves: [{ dateLabel: "Nov 10", sentence: "DOL put 215 of its cases on hold", tone: "bad" }] }));
    expect(html).toContain("five or more of its cases");
    expect(html).toContain("counted on November 12, 2026");
    expect(html).not.toContain("case by case");
  });
});
