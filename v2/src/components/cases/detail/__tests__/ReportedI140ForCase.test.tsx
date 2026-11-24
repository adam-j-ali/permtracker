import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pickI140Rows, ReportedI140ForCase } from "../ReportedI140ForCase";
import type { I140Summary } from "@/lib/reportedSummary";
import { textContent } from "../../../../../test-utils/text-content";

const row = (category: string, premium: I140Summary["premium"], medianDays: number | null, decided = 30): I140Summary => ({
  category, premium, reported: decided + 10, decidedAllTime: decided + 20, windowDays: 183, decided,
  approvedShare: medianDays === null ? null : 0.9, medianDays, rfeShare: medianDays === null ? null : 0.12,
});
const ROWS = [row("EB-3", "with filing", 21), row("EB-3", "none", 240), row("EB-3", "yes", 19), row("EB-2 NIW", "with filing", null, 3), row("EB-2 NIW", "yes", 30)];

describe("pickI140Rows", () => {
  it("compares a premium case with premium from filing, an ordinary one with no premium, and shows both when unsaid", () => {
    expect(pickI140Rows(ROWS, "EB-3", true).map((r) => r.premium)).toEqual(["with filing"]);
    expect(pickI140Rows(ROWS, "EB-3", false).map((r) => r.premium)).toEqual(["none"]);
    expect(pickI140Rows(ROWS, "EB-3", undefined).map((r) => r.premium)).toEqual(["with filing", "none"]);
  });

  it("reads the case form's NIW as the figures name it, and falls back to premium not said when from filing has too few", () => {
    expect(pickI140Rows(ROWS, "EB-2-NIW", true).map((r) => `${r.category} ${r.premium}`)).toEqual(["EB-2 NIW yes"]);
  });

  it("never borrows another kind's figure: with no row of its own, a case's kind says too few were reported", () => {
    // EB-2 has premium and premium-not-said rows only (as people report PERM cases): an ordinary case gets no figure.
    const eb2 = [row("EB-2", "yes", 20), row("EB-2", "not given", 24)];
    const [none] = pickI140Rows(eb2, "EB-2", false);
    expect(none).toMatchObject({ category: "EB-2", premium: "none", decided: 0, medianDays: null });
    expect(pickI140Rows(eb2, "EB-2", undefined).map((r) => `${r.premium} ${r.medianDays}`)).toEqual(["yes 20", "none null"]);
  });

  it("compares nothing without a category it knows", () => {
    expect(pickI140Rows(ROWS, undefined, true)).toEqual([]);
    expect(pickI140Rows(ROWS, "EB-5", true)).toEqual([]);
  });
});

describe("ReportedI140ForCase", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the median for cases like this one and this case's own wait against it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, i140: ROWS }))));
    render(<ReportedI140ForCase category="EB-3" premium={false} filedOn="2026-01-01" decidedOn="2026-10-01" />);
    expect(await screen.findByText("240 days")).toBeInTheDocument();
    expect(screen.getByText(/This one took 273 days, longer than the median of 240/)).toBeInTheDocument();
  });

  it("asks for the category instead of guessing, and fetches nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ReportedI140ForCase premium filedOn="2026-01-01" />);
    expect(screen.getByText(textContent(/Add the I-140's category/))).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says the figures couldn't be read rather than showing nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 502 })));
    render(<ReportedI140ForCase category="EB-3" premium />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be read");
  });

  it("tells an ordinary case there's too little to compare instead of showing a premium case's wait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, i140: [row("EB-3", "yes", 22), row("EB-3", "not given", 38)] }))));
    render(<ReportedI140ForCase category="EB-3" premium={false} filedOn="2026-01-01" />);
    expect(await screen.findByText(/None were reported decided in the last 12 months, too few for a typical wait/)).toBeInTheDocument();
    expect(screen.queryByText("38 days")).not.toBeInTheDocument();
    expect(screen.queryByText("22 days")).not.toBeInTheDocument();
  });

  it("says when too few were decided to give a typical wait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, i140: [row("EB-1", "none", null, 2)] }))));
    render(<ReportedI140ForCase category="EB-1" premium={false} />);
    expect(await screen.findByText(/Only 2 were reported decided in the last 6 months, too few/)).toBeInTheDocument();
  });
});
