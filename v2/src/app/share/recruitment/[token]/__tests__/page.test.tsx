/**
 * The page a recruitment record's share link opens: it says at the top what it is, shows the steps with their
 * dates, the filing window and the applicant log, holds nothing in a header or footer (print drops those), and
 * answers a link that's off, unknown or malformed with a 404, asking Convex nothing for a malformed one. It's kept
 * out of search, passes no referrer, and renders per request.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sharedRecruitmentRecord", () => ({ readSharedRecord: read }));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../RecordViewed", () => ({ RecordViewed: () => null }));

const TOKEN = "Zk3_x-9QwErTyUiOpAsDfGhJkLzXcVbNm1234567890";

const RECORD = {
  employerName: "ACME Robotics",
  positionTitle: "Robotics Engineer",
  steps: [
    { key: "job_order", label: "Job order with the state workforce agency", dates: [{ start: "2026-01-05", end: "2026-02-04" }] },
    { key: "sunday_ad_1", label: "First Sunday newspaper ad", dates: [{ start: "2026-01-11", end: null }] },
    { key: "sunday_ad_2", label: "Second Sunday newspaper ad, or the professional journal ad", dates: [] },
    { key: "notice_of_filing", label: "Notice of Filing", dates: [{ start: "2026-01-06", end: "2026-01-20" }] },
    { key: "radio_ad", label: "Radio ad", dates: [{ start: "2026-01-12", end: null }, { start: "2026-01-14", end: null }] },
  ],
  filingWindow: { opens: "2026-03-08", closes: "2026-07-04" },
  applicants: [
    { ref: "Applicant 1", appliedOn: "2026-01-12", contactedOn: "2026-01-14", contactMethod: "email", outcome: "not_qualified", reason: "No bachelor's degree, which the job requires." },
    { ref: "Applicant 2", appliedOn: null, contactedOn: null, contactMethod: null, outcome: "hired", reason: null },
    { ref: "Applicant 3", appliedOn: "2026-01-20", contactedOn: null, contactMethod: null, outcome: "pending", reason: null },
  ],
};

const page = async () => (await import("../page")).default;
const params = (token: string) => ({ params: Promise.resolve({ token }) });

describe("the shared recruitment record page", () => {
  beforeEach(() => {
    read.mockReset();
    notFound.mockClear();
  });

  it("says at the top what it is, then shows each step's dates, the filing window and the log", async () => {
    read.mockResolvedValue(RECORD);
    const Page = await page();
    const { container } = render(await Page(params(TOKEN)));
    expect(read).toHaveBeenCalledWith(TOKEN);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Recruitment record");
    expect(
      screen.getByText(
        "The recruitment record for Robotics Engineer at ACME Robotics, shared by your attorney's office through PERM Tracker. It updates as they work.",
      ),
    ).toBeInTheDocument();

    const steps = within(screen.getByRole("list", { name: "Recruitment steps" }));
    expect(steps.getByText("Jan 5, 2026 to Feb 4, 2026")).toBeInTheDocument();
    expect(steps.getByText("Jan 12, 2026 and Jan 14, 2026")).toBeInTheDocument();
    expect(steps.getByText("No date yet")).toBeInTheDocument();

    expect(screen.getByText("March 8, 2026")).toBeInTheDocument();
    expect(screen.getByText("July 4, 2026")).toBeInTheDocument();

    const log = within(screen.getByRole("table"));
    expect(log.getByText("No bachelor's degree, which the job requires.")).toBeInTheDocument();
    expect(log.getByText("Didn't meet the job's stated requirements")).toBeInTheDocument();
    expect(log.getAllByText("Hired").length).toBeGreaterThan(0);
    expect(screen.getByText("3 applicants: 1 hired, 1 still being considered and 1 not hired.")).toBeInTheDocument();

    // Print drops every header and footer element, so the record holds none.
    expect(container.querySelector("header, footer")).toBeNull();
    // Words never run together where two elements meet.
    expect(container.textContent).not.toMatch(/[a-z0-9.][A-Z][a-z]+ [a-z]/);
  });

  it("says so when no applicant is logged yet and the filing window isn't known", async () => {
    read.mockResolvedValue({ ...RECORD, applicants: [], filingWindow: null });
    const Page = await page();
    render(await Page(params(TOKEN)));
    expect(screen.getByText("No applicants are logged yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /filing window/i })).toBeNull();
  });

  it("answers a link that's off or unknown with a 404", async () => {
    read.mockResolvedValue(null);
    const Page = await page();
    await expect(Page(params(TOKEN))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("answers a malformed link with a 404 without asking Convex", async () => {
    const Page = await page();
    for (const bad of ["short", `${TOKEN}x`, "%2E%2E%2Fadmin", TOKEN.slice(0, 42) + "="]) {
      await expect(Page(params(bad))).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("lets a failed read throw, so the error screen shows rather than 'this link is off'", async () => {
    read.mockRejectedValue(new Error("Convex is down"));
    const Page = await page();
    await expect(Page(params(TOKEN))).rejects.toThrow("Convex is down");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("is kept out of search, passes no referrer, and renders on every request", async () => {
    const mod = await import("../page");
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.metadata.robots).toEqual({ index: false, follow: false });
    expect(mod.metadata.referrer).toBe("no-referrer");
    expect(JSON.stringify(mod.metadata)).not.toMatch(/url/i);
  });

  it("tells someone whose link is off what to do, kept out of search too", async () => {
    const mod = await import("../not-found");
    render(<mod.default />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link is off or doesn't exist");
    expect(mod.metadata.robots).toEqual({ index: false, follow: false });
    expect(mod.metadata.referrer).toBe("no-referrer");
  });
});
