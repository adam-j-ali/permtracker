// @vitest-environment jsdom
/**
 * The wage-request and LCA search: its filters narrow the loaded rows across
 * both halves, a filter on a file-only field drops a filing still in process,
 * and the wage-request search can widen past PERM requests on the API's own
 * `visa=all`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { FlagCaseRow, FlagDisclosedRow } from "@/lib/db/flagCases";

const usePublicQuery = vi.fn();
vi.mock("@/hooks/usePublicQuery", () => ({ usePublicQuery }));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("q=acme"),
  useRouter: () => ({ push }),
}));

const { FlagCaseBrowser, LCA_PROGRAM, PWD_PROGRAM } = await import("../FlagCaseBrowser");

function live(caseNumber: string, status: string): FlagCaseRow {
  return {
    caseNumber, filingDate: "2026-08-01", status, isFinal: status !== "IN PROCESS",
    employerName: "ACME", employerSlug: "acme", jobTitle: "Engineer", lastCheckedAt: null,
  } as FlagCaseRow;
}

function file(caseNumber: string, state: string, visa: string): FlagDisclosedRow {
  return {
    caseNumber, status: "Certified", receivedDate: "2025-01-01", decisionDate: "2025-01-08",
    employerName: "ACME", employerSlug: "acme", jobTitle: "Engineer", socCode: "15-1252.00",
    socTitle: "Software Developers", wage: 120000, wageUnit: "Year", worksiteState: state,
    visaClass: visa, fiscalYear: 2025, attorneyName: null, attorneySlug: null,
  };
}

const SEARCH = {
  cases: [live("I-200-26213-000001", "IN PROCESS")],
  disclosed: [file("I-200-25001-000002", "WA", "H-1B"), file("I-200-25001-000003", "CA", "E-3")],
};

beforeEach(() => {
  usePublicQuery.mockReset();
  usePublicQuery.mockImplementation((url: string) =>
    typeof url === "string" && url.includes("action=search")
      ? { data: SEARCH, failed: false }
      : { data: { rows: [], isDone: true, continueCursor: "0" }, failed: false },
  );
});

describe("FlagCaseBrowser search filters", () => {
  it("narrows both halves, and a file-only filter drops a filing still in process", () => {
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    expect(screen.getByText("I-200-26213-000001")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Worksite state"), { target: { value: "CA" } });
    expect(screen.getByText("I-200-25001-000003")).toBeInTheDocument();
    expect(screen.queryByText("I-200-25001-000002")).not.toBeInTheDocument();
    expect(screen.queryByText("I-200-26213-000001")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear these filters" }));
    expect(screen.getByText("I-200-26213-000001")).toBeInTheDocument();
  });

  it("offers visa class only when the loaded rows carry more than one", () => {
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    fireEvent.change(screen.getByLabelText("Visa class"), { target: { value: "E-3" } });
    expect(screen.getByText("I-200-25001-000003")).toBeInTheDocument();
    expect(screen.queryByText("I-200-25001-000002")).not.toBeInTheDocument();
  });

  it("widens a wage-request search past PERM requests, and the LCA search has no such box", () => {
    const { unmount } = render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    expect(screen.queryByLabelText(/other visas/)).not.toBeInTheDocument();
    unmount();
    render(<FlagCaseBrowser summary={null} program={PWD_PROGRAM} />);
    fireEvent.click(screen.getByLabelText(/other visas/));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const urls = usePublicQuery.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("action=search") && u.includes("visa=all"))).toBe(true);
  });

  it("asks the list for the oldest filings first when chosen", () => {
    render(<FlagCaseBrowser summary={null} program={PWD_PROGRAM} />);
    fireEvent.click(screen.getByRole("button", { name: "Oldest filing first" }));
    const urls = usePublicQuery.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("action=list") && u.includes("order=oldest"))).toBe(true);
  });
});

describe("FlagCaseBrowser names the finished filings for what the list holds", () => {
  // The wage list's button read "Issued · 520,636" and the line above it "520,636 issued". That count is every
  // request DOL is done with: on Nov 12 2026, 22,519 of them were withdrawn and 6,149 returned unprocessed, and the
  // rows under the button said so.
  const summary = {
    total: 566705,
    pending: 46069,
    decided: 520636,
    byStatus: { "DETERMINATION ISSUED": 490549, WITHDRAWN: 22519 },
    byVisaType: {},
    byPrefix: {},
    pendingByPrefix: {},
    byMonth: [],
    asOf: "2026-11-12T20:11:19Z",
    computedAt: 0,
  };

  it("calls them decided on the wage list, as the other lists do", () => {
    render(<FlagCaseBrowser summary={summary} program={PWD_PROGRAM} />);
    expect(screen.getByRole("button", { name: "Decided · 520,636" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Issued/ })).toBeNull();
    expect(screen.getByText(/46,069 still in process, 520,636 decided\./)).toBeInTheDocument();
  });
});

describe("FlagCaseBrowser's page is sized for the screen", () => {
  const screenIs = (narrow: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: narrow && q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  const listUrls = () => usePublicQuery.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("action=list"));
  const full = (n: number) => ({
    rows: Array.from({ length: n }, (_, i) => live(`P-100-26213-${String(i).padStart(6, "0")}`, "IN PROCESS")),
    isDone: false,
    continueCursor: String(n),
  });

  it("asks for 25 rows on a wide screen and 10 on a phone", () => {
    screenIs(false);
    const wide = render(<FlagCaseBrowser summary={null} program={PWD_PROGRAM} />);
    expect(listUrls().at(-1)).toContain("numItems=25");
    wide.unmount();
    usePublicQuery.mockClear();
    screenIs(true);
    render(<FlagCaseBrowser summary={null} program={PWD_PROGRAM} />);
    expect(listUrls().at(-1)).toContain("numItems=10");
    vi.unstubAllGlobals();
  });

  it("offers more rows on a phone, and a new size starts the list from its first page", () => {
    screenIs(true);
    usePublicQuery.mockImplementation((url: string) =>
      typeof url === "string" && url.includes("action=search")
        ? { data: SEARCH, failed: false }
        : { data: full(Number(/numItems=(\d+)/.exec(String(url))?.[1] ?? 0)), failed: false },
    );
    render(<FlagCaseBrowser summary={null} program={PWD_PROGRAM} />);
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(listUrls().at(-1)).toContain("cursor=10");
    fireEvent.click(screen.getByRole("button", { name: "50 rows per page" }));
    const last = listUrls().at(-1)!;
    expect(last).toContain("numItems=50");
    expect(last).not.toContain("cursor=");
    expect(screen.getByRole("button", { name: "50 rows per page" }).getAttribute("aria-pressed")).toBe("true");
    vi.unstubAllGlobals();
  });
});

describe("FlagCaseBrowser answers every press of Search", () => {
  it("says why when the employer name is too short", () => {
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "a" } });
    const before = usePublicQuery.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("status")).toHaveTextContent("Type at least two letters of the employer's name.");
    const after = usePublicQuery.mock.calls.slice(before).map((c) => String(c[0]));
    expect(after.some((u) => u.includes("text=a&") || u.endsWith("text=a"))).toBe(false);
  });

  it("searches for the name the box holds even when React never heard it typed", () => {
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    (screen.getByLabelText("Employer or case number") as HTMLInputElement).value = "globex";
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const urls = usePublicQuery.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("action=search") && u.includes("text=globex"))).toBe(true);
  });
});

describe("FlagCaseBrowser is the page's one search box", () => {
  // The list pages had a case-number box and, right under it, this employer search: two boxes back to back.
  // This one takes either, and a case number goes to its own page, where DOL is asked live.
  it("sends a typed case number to that case's page, and runs no employer search for it", () => {
    push.mockClear();
    usePublicQuery.mockReturnValue({ data: undefined, failed: false, failure: null, retry: vi.fn() });
    render(<FlagCaseBrowser summary={null} program={PWD_PROGRAM} />);
    const box = screen.getByLabelText("Employer or case number");
    fireEvent.change(box, { target: { value: "p-100-26140-123456" } });
    // Submitted as Enter in the box does (the button is busy while the address's own search loads).
    fireEvent.submit(box.closest("form")!);
    expect(push).toHaveBeenCalledWith("/perm-case-status?case=P-100-26140-123456");
  });

  it("is headed by what it finds, with no second box asked for", () => {
    usePublicQuery.mockReturnValue({ data: undefined, failed: false, failure: null, retry: vi.fn() });
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    expect(screen.getByRole("heading", { name: "Find an LCA" })).toBeTruthy();
    expect(screen.getAllByRole("textbox", { name: /Employer or case number/ })).toHaveLength(1);
  });

  it("says under the box what a case number gets: DOL asked live, and an email when it moves", () => {
    // The lists had a second box for the number, with this sentence. The two boxes became one and the sentence was lost.
    render(<FlagCaseBrowser summary={null} program={PWD_PROGRAM} />);
    const box = screen.getByRole("textbox", { name: "Employer or case number" });
    const note = document.getElementById(box.getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toBe(
      "Have the number? Type it here: DOL is asked live, and the case's page can email you when it moves.",
    );
  });
});

describe("FlagCaseBrowser's search results come a short page at a time", () => {
  // A search returns up to 200 filings from the daily check and 200 more from DOL's file. Both were drawn whole:
  // 17 to 25 screens each at desktop width (the control walk, Nov 12 2026), on pages whose own lists are 25 rows.
  const many = (n: number) => Array.from({ length: n }, (_, i) => live(`I-200-26213-${String(100000 + i)}`, "IN PROCESS"));
  const files = (n: number) => Array.from({ length: n }, (_, i) => file(`I-200-25001-${String(200000 + i)}`, "WA", "H-1B"));
  const answer = (cases: FlagCaseRow[], disclosed: FlagDisclosedRow[]) =>
    usePublicQuery.mockImplementation((url: string) =>
      typeof url === "string" && url.includes("action=search")
        ? { data: { cases, disclosed }, failed: false }
        : { data: { rows: [], isDone: true, continueCursor: "0" }, failed: false },
    );
  const rowsIn = (name: RegExp) => screen.getByRole("table", { name }).querySelectorAll("tbody tr").length;

  it("draws 25 of 60 found, says so, and turns the page", () => {
    // Arrange
    answer(many(60), []);

    // Act
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);

    // Assert: the first page, where it is, and the next one.
    expect(rowsIn(/matching the search/)).toBe(25);
    const pager = screen.getByRole("navigation", { name: "Pages of filings found" });
    expect(pager.textContent).toContain("1 to 25 of 60");
    expect(screen.getByText("I-200-26213-100000")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[0]!);
    expect(screen.queryByText("I-200-26213-100000")).toBeNull();
    expect(screen.getByText("I-200-26213-100025")).toBeInTheDocument();
    expect(pager.textContent).toContain("26 to 50 of 60");
  });

  it("pages the filings from DOL's file by themselves", () => {
    answer(many(3), files(40));
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    expect(rowsIn(/matching the search/)).toBe(3);
    expect(rowsIn(/from DOL's quarterly file/)).toBe(25);
    expect(screen.getByRole("navigation", { name: "Pages of decided filings from DOL's file" }).textContent).toContain("1 to 25 of 40");
  });

  it("orders the whole answer from a column header, and goes back to the first page", () => {
    // Arrange: 60 found, and the one whose title sorts first is the last of them, three pages down.
    const rows = many(60).map((r, i) => ({ ...r, jobTitle: i === 59 ? "Aardvark Keeper" : `Zoo Engineer ${i}` }));
    answer(rows, []);
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[0]!);
    expect(screen.queryByText("Aardvark Keeper")).toBeNull();

    // Act: sort by job title.
    const table = screen.getByRole("table", { name: /matching the search/ });
    fireEvent.click(within(table).getByRole("button", { name: /Job title/ }));

    // Assert: the page was cut after the sort, so the first of all 60 leads the first page.
    expect(screen.getByText("Aardvark Keeper")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pages of filings found" }).textContent).toContain("1 to 25 of 60");
  });

  it("a few results get no pager at all", () => {
    answer(many(3), files(2));
    render(<FlagCaseBrowser summary={null} program={LCA_PROGRAM} />);
    expect(screen.queryByRole("navigation", { name: "Pages of filings found" })).toBeNull();
    expect(rowsIn(/matching the search/)).toBe(3);
  });
});

