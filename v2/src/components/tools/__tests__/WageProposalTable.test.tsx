import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WageProposalTable } from "../WageProposalTable";
import type { LevelWage } from "@/lib/wageProposal";

// Software developers in the San Jose area, DOL's July 2026 to June 2027 series (read Nov 11 2026).
const SAN_JOSE: LevelWage[] = [
  { level: "I", hourly: 73.46, yearly: 152_797 },
  { level: "II", hourly: 89.94, yearly: 187_075 },
  { level: "III", hourly: 106.43, yearly: 221_374 },
  { level: "IV", hourly: 122.91, yearly: 255_653 },
];

const row = (level: string) => screen.getByRole("row", { name: new RegExp(`^Level ${level} `) });

describe("the proposed wage rule beside today's levels", () => {
  it("gives each level today's figure and what the proposal would make it, in dollars", () => {
    render(<WageProposalTable levels={SAN_JOSE} stage={{ sentToReview: "2026-11-06", finalPublished: null }} />);

    expect(within(row("I")).getByText("$152,797")).toBeInTheDocument();
    expect(within(row("I")).getByText("About $187,075")).toBeInTheDocument();
    expect(within(row("I")).getByText(/22% more: today's Level II/)).toBeInTheDocument();
    expect(within(row("II")).getByText("Above $221,374")).toBeInTheDocument();
    expect(within(row("II")).getByText(/18% more at least: today's Level III/)).toBeInTheDocument();
    expect(within(row("III")).getByText("Above $255,653")).toBeInTheDocument();
  });

  it("puts no dollar figure on the new Level IV: DOL publishes nothing that high", () => {
    render(<WageProposalTable levels={SAN_JOSE} stage={null} />);

    expect(within(row("IV")).getByText(/Higher than today\. DOL publishes no figure that high yet\./)).toBeInTheDocument();
    expect(within(row("IV")).queryByText(/About|Above/)).toBeNull();
  });

  it("names each level's percentiles the way they're said", () => {
    render(<WageProposalTable levels={SAN_JOSE} stage={null} />);

    expect(within(row("I")).getByText(/17th to 34th percentile/)).toBeInTheDocument();
    expect(within(row("II")).getByText(/34th to 52nd percentile/)).toBeInTheDocument();
    expect(within(row("IV")).getByText(/67th to 88th percentile/)).toBeInTheDocument();
  });

  it("says the final numbers aren't public while the rule is at the White House", () => {
    render(<WageProposalTable levels={SAN_JOSE} stage={{ sentToReview: "2026-11-06", finalPublished: null }} />);

    expect(screen.getByText(/sent the final rule to the White House for review on November 6, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/the final numbers aren't public yet/)).toBeInTheDocument();
  });

  it("says a final rule is out, and that these are still the proposal's figures, once one is published", () => {
    render(<WageProposalTable levels={SAN_JOSE} stage={{ sentToReview: "2026-11-06", finalPublished: "2026-12-15" }} />);

    expect(screen.getByText(/published a final rule on December 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/still the proposal's/)).toBeInTheDocument();
    expect(screen.queryByText(/aren't public yet/)).toBeNull();
  });

  it("guesses no stage when the rule's record couldn't be read", () => {
    render(<WageProposalTable levels={SAN_JOSE} stage={null} />);

    expect(screen.getByText(/No final rule has been published\./)).toBeInTheDocument();
    expect(screen.queryByText(/White House/)).toBeNull();
  });

  it("never says the proposal is in force", () => {
    render(<WageProposalTable levels={SAN_JOSE} stage={{ sentToReview: "2026-11-06", finalPublished: null }} />);

    expect(screen.getByText(/The levels in force are today's until a final rule takes effect\./)).toBeInTheDocument();
  });

  it("draws nothing for a row DOL printed with a level missing", () => {
    const { container } = render(<WageProposalTable levels={SAN_JOSE.slice(0, 3)} stage={null} />);

    expect(container.firstChild).toBeNull();
  });
});
