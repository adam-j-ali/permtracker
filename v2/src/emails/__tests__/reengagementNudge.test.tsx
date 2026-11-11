import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { ReengagementNudge } from "../ReengagementNudge";

/**
 * "We've missed you" goes only to an account with a live case (convex/reengagement.ts),
 * so it always knows how many, and its one link stops the weekly case summary, which is
 * what the link's page does.
 */
const html = (activeCaseCount: number) =>
  render(ReengagementNudge({ userName: "Jake", activeCaseCount, unsubscribeUrl: "https://permtracker.app/unsubscribe?token=SAMPLE" }));

describe("the re-engagement email", () => {
  it("says how many cases are tracked, in the singular for one", async () => {
    expect(await html(3)).toContain("Your 3 PERM cases are still being tracked");
    expect(await html(1)).toContain("Your 1 PERM case is still being tracked");
  });

  it("names what its link stops", async () => {
    const out = await html(2);
    expect(out).toContain("Stop the weekly case summary");
    expect(out).not.toContain("Unsubscribe from these emails");
  });
});
