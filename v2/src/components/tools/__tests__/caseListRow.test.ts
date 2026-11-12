import { describe, expect, it } from "vitest";

import { TITLE_ON_PHONE } from "../caseListRow";

/**
 * A phone's row in the case lists. For one release the job title was cut to one line with an ellipsis. People pick
 * their case out of an employer's list by the job title, and the end of a title is often the part that differs
 * ("Software Engineer II, Payments" beside "Software Engineer II, Platform"), so a phone shows two lines of it.
 */
describe("the job title on a phone's row", () => {
  const classes = TITLE_ON_PHONE.split(/\s+/);

  it("shows two lines before it cuts, never one", () => {
    expect(classes).toContain("max-sm:line-clamp-2");
    expect(classes).not.toContain("max-sm:truncate");
    expect(classes.some((c) => c.startsWith("max-sm:whitespace-nowrap"))).toBe(false);
  });

  it("keeps its place in the row's grid", () => {
    expect(classes).toContain("max-sm:[grid-area:title]");
  });
});
