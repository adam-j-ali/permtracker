import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { METRIC_MIN_N } from "@/lib/communityTimeline";

import { ContactOutcomes, InterviewLine, contactsText } from "../TimelineBoard";

/** After a contact, in words; the interview share only at the floor; a row's contacts as a count and kinds. */
describe("after a contact", () => {
  it("says each reported kind's count, its cards and its median, and leaves the rest out", () => {
    render(
      <ContactOutcomes
        outcomes={[
          { kind: "congressional", label: "congressional inquiry", reported: 6, withCard: 5, medianToCard: 32, waiting: 1 },
          { kind: "emma", label: "Emma or live-agent chat", reported: 1, withCard: 0, medianToCard: null, waiting: 1 },
          { kind: "ombudsman", label: "Ombudsman request", reported: 0, withCard: 0, medianToCard: null, waiting: 0 },
        ]}
      />,
    );
    expect(screen.getByText("After a congressional inquiry: 6 timelines, 5 with a green card, a median of 32 days later, 1 still waiting.")).toBeTruthy();
    expect(screen.getByText("After an Emma or live-agent chat: 1 timeline, none with a green card yet, 1 still waiting.")).toBeTruthy();
    expect(screen.queryByText(/Ombudsman/)).toBeNull();
  });

  it("draws nothing when nobody reports a contact", () => {
    const { container } = render(<ContactOutcomes outcomes={[]} />);
    expect(container.textContent).toBe("");
  });

  it("gives the interview share only once enough timelines say", () => {
    const { container, rerender } = render(<InterviewLine r={{ answered: METRIC_MIN_N - 1, waived: 2 }} />);
    expect(container.textContent).toBe("");
    rerender(<InterviewLine r={{ answered: 8, waived: 3 }} />);
    expect(screen.getByText("Of the 8 green cards whose timelines say how the interview went, 3 came without one.")).toBeTruthy();
  });

  it("puts a row's contacts in words", () => {
    expect(contactsText({ count: 2, kinds: ["emma", "congressional"] })).toBe("2 contacts: Emma or live-agent chat, congressional inquiry");
  });
});
