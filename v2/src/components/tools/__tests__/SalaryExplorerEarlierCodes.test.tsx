import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * A current job in a year of DOL's older files. BLS renumbered jobs in 2018 and those files carry the 2010 codes
 * (software developers were 15-1132 and 15-1133 before 15-1252), so the explorer offers each earlier code that holds
 * the year's cases, counted on its own, where it would otherwise read "no cases".
 */

let search = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/perm-wages",
  useSearchParams: () => search,
}));

const { SalaryExplorer } = await import("../SalaryExplorer");

const NONE = { n: 0, avg: null, p5: null, p25: null, p50: null, p75: null, p95: null };
const EMPTY = { stats: NONE, bins: [], binWidth: 0, below: 0, above: 0, byState: [] };
const EARLIER = [
  { code: "15-1132", title: "Software Developers, Applications", n: 8_100 },
  { code: "15-1133", title: "Software Developers, Systems Software", n: 1_900 },
];
const NOTE = "15-1132 and 15-1133 also covered 15-1253 (Software Quality Assurance Analysts and Testers).";

const explorer = () => (
  <SalaryExplorer
    occupations={[{ value: "15-1252", label: "Software Developers", n: 9 }]}
    states={[{ value: "WA", label: "WA", n: 9 }]}
    fiscalYears={["2026", "2025", "2024", "2015"]}
    historyYears={["2015"]}
    initial={EMPTY}
    placeFilters
  />
);

const fetchMock = vi.fn();
beforeEach(() => {
  replace.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const answer = (body: object) => fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => body });

describe("SalaryExplorer and a job's 2010 codes", () => {
  it("offers each earlier code with its count where the new one holds no case", async () => {
    answer({ ...EMPTY, earlierCodes: EARLIER, earlierNote: NOTE });
    search = new URLSearchParams("soc=15-1252&fy=2015");
    render(explorer());
    expect(await screen.findByText(/DOL's FY2015 file lists this job under BLS's older 2010 codes/)).toBeInTheDocument();
    const first = screen.getByRole("button", { name: /15-1132 Software Developers, Applications \(8,100 cases\)/ });
    expect(first).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /15-1133 Software Developers, Systems Software \(1,900 cases\)/ }))
      .toBeInTheDocument();
    expect(screen.getByText(new RegExp(NOTE.replace(/[()]/g, "\\$&")))).toBeInTheDocument();
  });

  it("switches the occupation to the code picked, keeping the year, and names it in the box", async () => {
    answer({ ...EMPTY, earlierCodes: EARLIER, earlierNote: NOTE });
    search = new URLSearchParams("soc=15-1252&fy=2015");
    const view = render(explorer());
    fireEvent.click(await screen.findByRole("button", { name: /15-1132 Software Developers, Applications/ }));
    const to = new URLSearchParams(String(replace.mock.calls[0]?.[0]).split("?")[1]);
    expect(to.get("soc")).toBe("15-1132");
    expect(to.get("fy")).toBe("2015");
    answer({ ...EMPTY, stats: { ...NONE, n: 8_100 } });
    search = new URLSearchParams("soc=15-1132&fy=2015");
    view.rerender(explorer());
    await waitFor(() => expect(screen.getByText(/Software Developers, Applications, every state, FY2015/)).toBeInTheDocument());
  });

  it("says the figures leave them out where the new code holds some of the year's cases", async () => {
    answer({ ...EMPTY, stats: { ...NONE, n: 400 }, earlierCodes: EARLIER, earlierNote: NOTE });
    search = new URLSearchParams("soc=15-1252&fy=2015");
    render(explorer());
    expect(
      await screen.findByText(/DOL's FY2015 file also lists some of this job's cases under BLS's older 2010 codes/),
    ).toBeInTheDocument();
  });

  it("shows nothing of the kind for a job that kept its number", async () => {
    answer(EMPTY);
    search = new URLSearchParams("soc=15-1252&fy=2015");
    render(explorer());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/2010 codes/)).not.toBeInTheDocument();
  });
});
