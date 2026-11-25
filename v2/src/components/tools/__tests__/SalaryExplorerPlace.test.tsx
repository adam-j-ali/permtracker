import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The explorer's city and industry narrowings: offered only where the route
 * accepts them, disabled until the slice they narrow is chosen, sent with the
 * request, and dropped with the state or occupation they depend on.
 */

let search = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/perm-wages",
  useSearchParams: () => search,
}));

const { SalaryExplorer } = await import("../SalaryExplorer");

const EMPTY = {
  stats: { n: 0, avg: null, p5: null, p25: null, p50: null, p75: null, p95: null },
  bins: [], binWidth: 0, below: 0, above: 0, byState: [],
};

function renderIt(placeFilters: boolean) {
  render(
    <SalaryExplorer
      occupations={[{ value: "15-1252", label: "Software Developers", n: 9 }]}
      states={[{ value: "WA", label: "WA", n: 9 }]}
      fiscalYears={["2026"]}
      initial={EMPTY}
      placeFilters={placeFilters}
    />,
  );
}

const fetchMock = vi.fn();
beforeEach(() => {
  replace.mockReset();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => EMPTY });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("SalaryExplorer place filters", () => {
  it("disables both until a state (or, for industry, an occupation) is chosen", () => {
    search = new URLSearchParams();
    renderIt(true);
    expect(screen.getByLabelText("Worksite city")).toBeDisabled();
    expect(screen.getByLabelText("Industry")).toBeDisabled();
  });

  it("sends the city and the sector with the request", () => {
    search = new URLSearchParams("state=WA&city=Seattle&sector=51");
    renderIt(true);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("city=Seattle");
    expect(url).toContain("sector=51");
  });

  it("ignores them on a page that doesn't offer them", () => {
    search = new URLSearchParams("state=WA&city=Seattle&sector=51");
    renderIt(false);
    expect(screen.queryByLabelText("Worksite city")).not.toBeInTheDocument();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).not.toContain("city=");
    expect(url).not.toContain("sector=");
  });

  it("drops the city with its state, and the sector with the last of state and occupation", () => {
    search = new URLSearchParams("state=WA&city=Seattle&sector=51");
    renderIt(true);
    fireEvent.change(screen.getByLabelText("Worksite state"), { target: { value: "" } });
    const to = String(replace.mock.calls[0]?.[0]);
    expect(to).not.toContain("city=");
    expect(to).not.toContain("sector=");
  });

  it("commits a typed city on Enter", () => {
    search = new URLSearchParams("state=WA");
    renderIt(true);
    const box = screen.getByLabelText("Worksite city");
    fireEvent.change(box, { target: { value: "  Redmond " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(String(replace.mock.calls[0]?.[0])).toContain("city=Redmond");
  });
});

describe("SalaryExplorer years from DOL's older files", () => {
  function renderYears(pooledLabel?: string) {
    render(
      <SalaryExplorer
        occupations={[{ value: "15-1252", label: "Software Developers", n: 9 }]}
        states={[{ value: "WA", label: "WA", n: 9 }]}
        fiscalYears={["2026", "2025", "2024", "2015"]}
        historyYears={["2015"]}
        pooledLabel={pooledLabel}
        initial={EMPTY}
        placeFilters
      />,
    );
  }

  it("names the pooled choice by the years it pools", () => {
    search = new URLSearchParams();
    renderYears("FY2024 to FY2026");
    const select = screen.getByLabelText("Fiscal year") as HTMLSelectElement;
    expect(select.options[0]!.textContent).toBe("FY2024 to FY2026");
    expect(screen.queryByText("All years")).toBeNull();
    expect(screen.getByText(/All occupations · every state · FY2024 to FY2026/)).toBeInTheDocument();
  });

  it("keeps 'All years' where nothing names the pool (the LCA page)", () => {
    search = new URLSearchParams();
    renderYears();
    expect((screen.getByLabelText("Fiscal year") as HTMLSelectElement).options[0]!.textContent).toBe("All years");
  });

  it("offers the older years, and no city or industry for them", () => {
    search = new URLSearchParams("state=WA&fy=2015&city=Seattle&sector=51");
    renderYears("FY2024 to FY2026");
    expect(screen.getByRole("option", { name: "FY2015" })).toBeInTheDocument();
    expect(screen.getByLabelText("Worksite city")).toBeDisabled();
    expect(screen.getByLabelText("Industry")).toBeDisabled();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("fy=2015");
    expect(url).not.toContain("city=");
    expect(url).not.toContain("sector=");
  });

  it("drops a city and an industry when an older year is picked", () => {
    search = new URLSearchParams("state=WA&city=Seattle&sector=51");
    renderYears("FY2024 to FY2026");
    fireEvent.change(screen.getByLabelText("Fiscal year"), { target: { value: "2015" } });
    const to = String(replace.mock.calls[0]?.[0]);
    expect(to).toContain("fy=2015");
    expect(to).not.toContain("city=");
    expect(to).not.toContain("sector=");
  });

  it("says why, under the filters", () => {
    search = new URLSearchParams("state=WA&fy=2015");
    renderYears("FY2024 to FY2026");
    expect(screen.getByText(/DOL's older files/)).toBeInTheDocument();
  });
});
