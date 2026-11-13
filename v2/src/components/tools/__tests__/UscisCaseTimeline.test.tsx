import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UscisCaseTimeline, type InquiryRow } from "../UscisCaseTimeline";

// The address the tool reads its opening form from.
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tools/uscis-case-inquiry",
}));
beforeEach(() => {
  nav.params = new URLSearchParams();
});

/**
 * A USCIS case on its calendar: the day half of such cases were decided by, the day eight in ten were, and the
 * day USCIS takes a question, each from the row USCIS posted for the form, category and office picked.
 */

// The page reads the reader's own day; pin it (Monday, November 9, 2026, midday).
beforeAll(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 9, 12, 0, 0), toFake: ["Date"] });
});
afterAll(() => {
  vi.useRealTimers();
});

const row = (over: Partial<InquiryRow>): InquiryRow => ({
  form: "I-485",
  subtype: "131A",
  label: "Employment-based adjustment applications",
  office: "FOD",
  officeLabel: "All field offices",
  requestDate: "2025-04-21",
  posted: 9.5,
  postedText: "9.5 Months",
  median: { months: 6, quarter: "FY2026 Q3 (Apr to Jun 2026)" },
  ...over,
});
const ROWS: InquiryRow[] = [
  row({}),
  row({ office: "SCD", officeLabel: "Service Center Operations", requestDate: "2022-10-28", posted: 42.5, postedText: "42.5 Months" }),
  row({ subtype: "131T", label: "Based on an approved T Visa", office: "VSC", officeLabel: "Vermont Service Center", requestDate: "2023-01-10", posted: 40, postedText: "40 Months", median: null }),
  row({ form: "I-140", subtype: "136A-E21", label: "Advanced degree or exceptional ability (E21)", office: "SCD", officeLabel: "Service Center Operations", requestDate: "2025-06-02", posted: 8, postedText: "8 Months", median: { months: 3.9, quarter: "FY2026 Q3 (Apr to Jun 2026)", wholeForm: true } }),
  row({ form: "I-90", subtype: "90A", label: "Initial issuance or replacement", office: "POB", officeLabel: "Potomac Service Center", requestDate: null, posted: null, postedText: null, median: null }),
];
const NAMES = { "I-485": "Application to Register Permanent Residence or Adjust Status", "I-140": "Immigrant Petition for Alien Workers" };

const mount = () => render(<UscisCaseTimeline rows={ROWS} published="2026-10-19" formNames={NAMES} />);
const receipt = (day: string) => fireEvent.change(screen.getByLabelText("Receipt date"), { target: { value: day } });

describe("UscisCaseTimeline", () => {
  it("opens on the employment-based I-485 and waits for a receipt date", () => {
    mount();
    expect(screen.getByLabelText("Form")).toHaveValue("I-485");
    expect(screen.getByLabelText("Category")).toHaveValue("131A");
    expect(screen.getByText("Enter the receipt date on your notice to see your case's dates.")).toBeInTheDocument();
    expect(screen.queryByText(/Half of cases like yours/)).toBeNull();
  });

  it("opens on the form a link names, and on its usual form when the link names one USCIS doesn't post", () => {
    nav.params = new URLSearchParams("form=i-140");
    const { unmount } = render(<UscisCaseTimeline rows={ROWS} published="2026-10-19" formNames={NAMES} />);
    expect(screen.getByLabelText("Form")).toHaveValue("I-140");
    // The reader's own pick wins over the address from then on.
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "I-90" } });
    expect(screen.getByLabelText("Form")).toHaveValue("I-90");
    unmount();
    nav.params = new URLSearchParams("form=I-999");
    render(<UscisCaseTimeline rows={ROWS} published="2026-10-19" formNames={NAMES} />);
    expect(screen.getByLabelText("Form")).toHaveValue("I-485");
  });

  it("opens on the employment-based adjustment even though USCIS lists the family-based one first", () => {
    const family = row({ subtype: "131A-FAM", label: "Family-based adjustment applications", office: "ABQ", officeLabel: "Albuquerque NM", median: { months: 7, quarter: "FY2026 Q3 (Apr to Jun 2026)" } });
    render(<UscisCaseTimeline rows={[family, ...ROWS]} published="2026-10-19" formNames={NAMES} />);
    expect(screen.getByLabelText("Category")).toHaveValue("131A");
    expect(screen.getByLabelText("Office on your receipt notice")).toHaveValue("FOD");
    // The reader's own pick still wins, and a form with no such preference opens on USCIS's first.
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "131A-FAM" } });
    expect(screen.getByLabelText("Office on your receipt notice")).toHaveValue("ABQ");
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "I-140" } });
    expect(screen.getByLabelText("Category")).toHaveValue("136A-E21");
  });

  it("opens the work permit, the travel paper and the I-140 on the category a green card case holds", () => {
    const more = [
      row({ form: "I-765", subtype: "147-C10", label: "Suspension of deportation [(c)(10)]", office: "SCD", officeLabel: "Service Center Operations" }),
      row({ form: "I-765", subtype: "147-C9", label: "Based on a pending I-485 adjustment application [(c)(9)]", office: "SCD", officeLabel: "Service Center Operations" }),
      row({ form: "I-131", subtype: "141A-RT", label: "Re-entry permit or refugee travel document", office: "SCD", officeLabel: "Service Center Operations" }),
      row({ form: "I-131", subtype: "141B-OTH", label: "Advance parole", office: "SCD", officeLabel: "Service Center Operations" }),
      row({ form: "I-140", subtype: "136A-E11", label: "Extraordinary ability (E11)", office: "SCD", officeLabel: "Service Center Operations" }),
    ];
    render(<UscisCaseTimeline rows={[...more, ...ROWS]} published="2026-10-19" formNames={NAMES} />);
    for (const [form, opens] of [["I-765", "147-C9"], ["I-131", "141B-OTH"], ["I-140", "136A-E21"]] as const) {
      fireEvent.change(screen.getByLabelText("Form"), { target: { value: form } });
      expect(screen.getByLabelText("Category"), form).toHaveValue(opens);
    }
    // A form with no such preference opens on USCIS's first.
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "I-90" } });
    expect(screen.getByLabelText("Category")).toHaveValue("90A");
  });

  it("puts USCIS's two figures and the inquiry day on the case's calendar, each with where it comes from", () => {
    mount();
    receipt("2026-06-09");
    // Half in 6.0 months, eight in ten in 9.5, counted from the receipt date.
    expect(screen.getByText("Half of cases like yours were decided by December 9, 2026.")).toBeInTheDocument();
    expect(screen.getByText(/USCIS's median for this kind of case was 6 months in FY2026 Q3 \(Apr to Jun 2026\), across every office\./)).toBeInTheDocument();
    expect(screen.getByText("Eight in ten were decided by March 24, 2027.")).toBeInTheDocument();
    expect(screen.getByText(/USCIS's posted time for this office is 9\.5 months\./)).toBeInTheDocument();
    // The 93% time is the posting day less the cutoff (546 days), added to the receipt date.
    expect(screen.getByText("You can ask from about December 7, 2027.")).toBeInTheDocument();
    expect(screen.getByText(/From USCIS's posting of October 19, 2026\./)).toBeInTheDocument();
  });

  it("says a case received before USCIS's cutoff can be asked about now, and marks the first step open", () => {
    mount();
    receipt("2025-03-03");
    expect(screen.getByText("You can ask USCIS about your case now.")).toBeInTheDocument();
    expect(screen.getByText("Open to you now")).toBeInTheDocument();
  });

  it("reads the office picked: the same form and day under another office's posted time", () => {
    mount();
    receipt("2026-06-09");
    fireEvent.change(screen.getByLabelText("Office on your receipt notice"), { target: { value: "SCD" } });
    expect(screen.getByText(/USCIS's posted time for this office is 42\.5 months\./)).toBeInTheDocument();
    expect(screen.queryByText("Eight in ten were decided by March 24, 2027.")).toBeNull();
  });

  it("shows no median where USCIS's quarterly report has no line for the same cases", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "131T" } });
    receipt("2026-06-09");
    expect(screen.queryByText(/Half of cases like yours/)).toBeNull();
    expect(screen.getByText(/Eight in ten were decided by/)).toBeInTheDocument();
  });

  it("starts the category and the office over when the form changes", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Office on your receipt notice"), { target: { value: "SCD" } });
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "I-140" } });
    expect(screen.getByLabelText("Category")).toHaveValue("136A-E21");
    expect(screen.getByLabelText("Office on your receipt notice")).toHaveValue("SCD");
    receipt("2026-08-03");
    // The I-140's median counts every category, so it's a sentence about the form and never this case's date.
    expect(screen.queryByText(/Half of cases like yours/)).toBeNull();
    expect(screen.getByText(/Across every I-140 category together, half were decided within 3\.9 months/)).toBeInTheDocument();
  });

  it("keeps a whole form's median off the case's calendar, and says whose it is", () => {
    // What a reader saw on Nov 13 2026: an E21 petition received Nov 6, with USCIS posting 3 months for it.
    const e21 = row({ form: "I-140", subtype: "136A-E21", label: "Advanced degree or exceptional ability (E21)", office: "SCD", officeLabel: "Service Center Operations", requestDate: "2026-05-01", posted: 3, postedText: "3 Months", median: { months: 3.9, quarter: "FY2026 Q3 (Apr to Jun 2026)", wholeForm: true } });
    render(<UscisCaseTimeline rows={[e21]} published="2026-10-19" formNames={NAMES} />);
    receipt("2026-11-06");
    expect(screen.getByText("Eight in ten were decided by February 6, 2027.")).toBeInTheDocument();
    expect(screen.queryByText(/Half decided by/)).toBeNull();
    expect(screen.queryByText(/Half of cases like yours/)).toBeNull();
    expect(screen.getByText(/That figure counts all of them, so it isn't a date for yours\./)).toBeInTheDocument();
  });

  it("still marks half and eight in ten for a case whose median is its own", () => {
    mount();
    receipt("2026-06-09");
    expect(screen.getByText("Half of cases like yours were decided by December 9, 2026.")).toBeInTheDocument();
    expect(screen.getByText(/Half decided by/)).toBeInTheDocument();
    expect(screen.queryByText(/Across every/)).toBeNull();
  });

  it("falls back to USCIS's six-month default for a form it posts no time for", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "I-90" } });
    receipt("2026-08-03");
    expect(screen.getByText("You can ask from February 3, 2027.")).toBeInTheDocument();
    expect(screen.getByText(/USCIS posts no time for this one, so its default applies/)).toBeInTheDocument();
    expect(screen.queryByText(/Eight in ten/)).toBeNull();
  });

  it("refuses a receipt date that hasn't come", () => {
    mount();
    receipt("2027-01-01");
    expect(screen.getByText("That date hasn't come yet. Enter the receipt date on your notice.")).toBeInTheDocument();
    expect(screen.queryByText(/You can ask/)).toBeNull();
  });

  it("names the priority date as the thing the calendar can't see, on an adjustment by employment or family only", () => {
    mount();
    expect(screen.getByText(/One thing the dates above can't see: your priority date\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "priority date calculator" })).toHaveAttribute("href", "/tools/priority-date-calculator");
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "I-140" } });
    expect(screen.queryByText(/your priority date\./)).toBeNull();
  });

  it("drafts the note for a congressional office from what's typed, and never asks for a Social Security number", () => {
    mount();
    receipt("2025-03-03");
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam Example" } });
    fireEvent.change(screen.getByLabelText("Receipt number"), { target: { value: "IOE0912345678" } });
    const note = screen.getByTestId("congress-note").textContent ?? "";
    expect(note).toContain("My name is Sam Example.");
    expect(note).toContain("Receipt number: IOE0912345678");
    expect(note).toContain("Form: I-485, Application to Register Permanent Residence or Adjust Status (Employment-based adjustment applications)");
    expect(note).toContain("takes inquiries for cases received before April 21, 2025");
    expect(note.toLowerCase()).not.toContain("social security number:");
    const section = screen.getByRole("heading", { name: "A note for a congressional office" }).closest("section")!;
    expect(within(section).getByText(/Never put a Social Security number in it\./)).toBeInTheDocument();
  });
});
