/**
 * The agency's own line for a step people haven't reported yet (Nov 25 2026, the owner's call: the empty H-1B and LCA
 * rows stay and show the agencies' figures): USCIS's posted H-1B times for "H-1B filed to decided", and DOL's
 * seven-working-day rule beside the LCA step, which no agency measures.
 */
import { describe, expect, it } from "vitest";

import { agencyStepNotes } from "../agencyStepNotes";

const row = (subtype: string, posted: number | null, label: string) => ({
  form: "I-129", subtype, office: "SCD", posted, postedText: null, requestDate: null, label, officeLabel: null,
});

describe("agencyStepNotes", () => {
  it("names USCIS's posted months for each H-1B kind, with the day it posted them", () => {
    const notes = agencyStepNotes({
      published: "2026-11-20",
      newest: [
        row("137-H1B1", 15, "H-1B - Specialty occupation - Visa to be issued abroad"),
        row("137-H1B2", 5, "H-1B - Specialty occupation - Change of status in the U.S."),
        row("137-H1B3", 11.5, "H-1B - Specialty occupation - Extension of stay in the U.S."),
        row("137-L", 4, "L-1"),
      ],
    });
    expect(notes.h1b).toBe(
      "USCIS says it decides 80% of H-1B petitions within 5 months for a change of status, 11.5 months for an extension " +
        "and 15 months when the visa is issued abroad (posted November 20, 2026).",
    );
  });
  it("says no agency measures the LCA-to-H-1B gap, and gives DOL's rule for the LCA", () => {
    expect(agencyStepNotes(null)["lca-h1b"]).toBe(
      "No agency measures this gap: it's the employer's timing. DOL decides the LCA itself within 7 working days of " +
        "receiving it (20 CFR 655.740).",
    );
  });
  it("gives no H-1B line when USCIS's times aren't loaded or name no H-1B row", () => {
    expect(agencyStepNotes(null).h1b).toBeUndefined();
    expect(agencyStepNotes({ published: "2026-11-20", newest: [row("137-L", 4, "L-1")] }).h1b).toBeUndefined();
  });
});
