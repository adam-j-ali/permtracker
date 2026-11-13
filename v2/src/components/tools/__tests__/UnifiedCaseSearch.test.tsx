// @vitest-environment jsdom
/**
 * The master case search's worker, job and industry filters, its order
 * control and its CSV link, as a reader meets them.
 *
 * What is pinned is what the route is SENT and what the reader is TOLD: a
 * filter that never reaches the wire, an order the table does not show, a
 * download that asks for a different search than the page, and a row whose
 * worker fields vanish are each invisible in a result count.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { UnifiedCase } from "@/lib/db/unifiedSearch";

const usePublicQuery = vi.fn();
vi.mock("@/hooks/usePublicQuery", () => ({ usePublicQuery }));
const address = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => address.params,
  useRouter: () => ({ push: vi.fn() }),
}));

const { UnifiedCaseSearch } = await import("../UnifiedCaseSearch");

const row = (caseNumber: string, over: Partial<UnifiedCase> = {}): UnifiedCase =>
  ({
    caseNumber, program: "perm", half: "published", status: "certified", isFinal: true,
    filedOn: "2019-01-02", decidedOn: "2019-06-01", employerName: "ACME CORP", employerSlug: "acme-corp",
    jobTitle: "Engineer", wage: 120000, wageUnit: null, state: "WA", firmName: null, firmSlug: null,
    socCode: "15-1252.00", socTitle: "Software Developers", days: 150, ...over,
  }) as UnifiedCase;

function answer(over: Record<string, unknown> = {}) {
  return {
    rows: [
      row("A-19001-00001", {
        era: "history", city: "SEATTLE", industryTitle: "Custom Computer Programming Services",
        citizenship: "INDIA", birthCountry: "INDIA", visaClass: "H-1B", education: "Master's",
        major: "COMPUTER SCIENCE", jobEducation: "Bachelor's", wage: 90000,
      }),
      row("G-100-24001-000002", { wage: 150000, decidedOn: "2024-03-01" }),
    ],
    counts: { perm: 2, pwd: 0, lca: 0, seasonal: 0 },
    truncated: false, capped: false, windowed: false,
    skipped: { live: true, published: false, because: ["citizenship"] },
    lead: { kind: "employer", value: "acme" },
    resolved: { firm: null, occupation: null },
    dropped: [], needsLead: false,
    permOnly: ["citizenship"], order: "wage-desc", orderScope: "complete",
    ...over,
  };
}

const OPTIONS = {
  citizenship: [{ value: "INDIA", n: 1200 }, { value: "KOREA, SOUTH", n: 90 }],
  birthCountry: [], visaClass: [{ value: "H-1B", n: 800 }], education: [], jobEducation: [],
};

/** The query string the component last asked the route for. */
const lastAsked = () => {
  const urls = usePublicQuery.mock.calls.map((c) => String(c[0])).filter((u) => u !== "skip");
  return new URLSearchParams((urls.at(-1) ?? "").split("?")[1] ?? "");
};

beforeEach(() => {
  address.params = new URLSearchParams();
  usePublicQuery.mockReset();
  usePublicQuery.mockImplementation((url: string) =>
    url === "skip" ? { data: undefined, failed: false } : { data: answer(), failed: false },
  );
});

function renderIt() {
  return render(
    <UnifiedCaseSearch
      industries={[{ code: "31-33", title: "Manufacturing" }, { code: "54", title: "Professional, Scientific, and Technical Services" }]}
      fieldOptions={OPTIONS}
      publishedFrom="2016"
    />,
  );
}

describe("the worker, job and industry filters", () => {
  it("sends each one with the search, the typed NAICS code over the sector", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Industry" }), { target: { value: "31-33" } });
    // Citizenship is a box you type into: open it, find the country, pick it.
    fireEvent.click(screen.getByRole("combobox", { name: "Citizenship" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Find countries" }), { target: { value: "korea" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Korea, South (90)" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Visa at filing" }), { target: { value: "H-1B" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Worker's education" }), { target: { value: "Master's" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Worksite city" }), { target: { value: "Seattle" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    let q = lastAsked();
    expect(q.get("naics")).toBe("31-33");
    expect(q.get("cit")).toBe("KOREA, SOUTH");
    expect(q.get("visa")).toBe("H-1B");
    expect(q.get("edu")).toBe("Master's");
    expect(q.get("city")).toBe("Seattle");

    fireEvent.change(screen.getByRole("textbox", { name: /NAICS code/ }), { target: { value: "5415" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    q = lastAsked();
    expect(q.get("naics")).toBe("5415");
  });

  it("shows countries in title case with their counts, and keeps DOL's spelling as the value", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Citizenship" }));
    expect(screen.getByRole("option", { name: "India (1,200)" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: "Korea, South (90)" }));
    expect(screen.getByRole("combobox", { name: "Citizenship" })).toHaveTextContent("Korea, South (90)");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(lastAsked().get("cit")).toBe("KOREA, SOUTH");
  });

  it("names a value the route would refuse instead of sending it", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Worksite city" }), { target: { value: "Seattle; DROP" } });
    fireEvent.change(screen.getByRole("textbox", { name: /NAICS code/ }), { target: { value: "54a" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(lastAsked().has("city")).toBe(false);
    expect(lastAsked().has("naics")).toBe(false);
    expect(screen.getByText(/NAICS code and Worksite city weren't used\./)).toBeInTheDocument();
  });

  it("says the old-form fields exist only for cases filed on DOL's old form", () => {
    renderIt();
    expect(screen.getByText(/doesn't carry them\./)).toBeInTheDocument();
  });

  it("offers the way out beside the note that a wage source turned the worker's fields off", () => {
    // Arrange
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Prevailing wage source" }), { target: { value: "survey" } });
    expect(screen.getByText(/Clear the wage source to use them\./)).toBeInTheDocument();
    // Act
    fireEvent.click(screen.getByRole("button", { name: "Clear the wage source" }));
    // Assert
    expect(screen.getByRole("combobox", { name: "Prevailing wage source" })).toHaveValue("");
    expect(screen.queryByText(/Clear the wage source to use them\./)).not.toBeInTheDocument();
  });
});

describe("one exact filing day", () => {
  it("sends the day as both ends of the filed range", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Filed on one day"), { target: { value: "2026-01-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const q = lastAsked();
    expect(q.get("from")).toBe("2026-01-30");
    expect(q.get("to")).toBe("2026-01-30");
  });

  it("is one filter with the months: setting either empties the other, so the boxes show what's used", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Filed from"), { target: { value: "2026-01" } });
    fireEvent.change(screen.getByLabelText("Filed to"), { target: { value: "2026-03" } });
    fireEvent.change(screen.getByLabelText("Filed on one day"), { target: { value: "2026-02-14" } });
    expect(screen.getByLabelText("Filed from")).toHaveValue("");
    expect(screen.getByLabelText("Filed to")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Filed from"), { target: { value: "2026-01" } });
    expect(screen.getByLabelText("Filed on one day")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const q = lastAsked();
    expect(q.get("from")).toBe("2026-01");
    expect(q.has("to")).toBe(false);
  });

  it("reads a shared address's day back into its box, and keeps a month range in the month boxes", () => {
    address.params = new URLSearchParams("q=acme&from=2026-01-30&to=2026-01-30");
    const { unmount } = renderIt();
    expect(screen.getByLabelText("Filed on one day")).toHaveValue("2026-01-30");
    expect(screen.getByLabelText("Filed from")).toHaveValue("");
    expect(lastAsked().get("from")).toBe("2026-01-30");
    unmount();

    address.params = new URLSearchParams("q=acme&from=2026-01&to=2026-03");
    renderIt();
    expect(screen.getByLabelText("Filed on one day")).toHaveValue("");
    expect(screen.getByLabelText("Filed from")).toHaveValue("2026-01");
    expect(screen.getByLabelText("Filed to")).toHaveValue("2026-03");
  });
});

describe("the answer", () => {
  it("says a PERM-only filter left the other programs out", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Only published PERM cases are in this answer.")).toBeInTheDocument();
  });

  it("shows the worker and job under the title, and marks a row from the FY2008 to FY2023 file", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Seattle · Custom Computer Programming Services")).toBeInTheDocument();
    expect(screen.getByText(/Worker: India citizen, H-1B at filing, Master's in Computer Science/)).toBeInTheDocument();
    expect(screen.getByText(/Job requires: Bachelor's/)).toBeInTheDocument();
    expect(screen.getAllByText("FY2008 to FY2023 file")).toHaveLength(1);
  });

  it("links a decided case's wage request, and the PERM cases a wage request is named on", () => {
    usePublicQuery.mockImplementation((url: string) =>
      url === "skip"
        ? { data: undefined, failed: false }
        : {
            data: answer({
              rows: [
                row("G-100-25153-039450", { wageRequest: "P-100-24318-472007" }),
                row("P-100-24318-472007", { program: "pwd", namedBy: 2 }),
                row("G-100-26030-000002", { half: "live", isFinal: false, status: "ANALYST REVIEW" }),
              ],
              counts: { perm: 2, pwd: 1, lca: 0, seasonal: 0 },
              permOnly: [],
              skipped: { live: false, published: false, because: [] },
            }),
            failed: false,
          },
    );
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getAllByRole("link", { name: "Wage request P-100-24318-472007" })[0]).toHaveAttribute("href", "/perm-case-status?case=P-100-24318-472007");
    expect(screen.getAllByRole("link", { name: "Named on 2 decided PERM cases" })[0]).toHaveAttribute("href", "/perm-case-status?case=P-100-24318-472007");
    // One of each: the pending case's row names nothing.
    const table = document.querySelector("tbody")!;
    expect(table.querySelectorAll('a[href="/perm-case-status?case=P-100-24318-472007"]').length).toBeGreaterThanOrEqual(2);
    expect(table.textContent?.match(/Wage request P-/g) ?? []).toHaveLength(1);
  });

  it("orders the table as asked and says whether the order covers every match", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Order the answer by"), { target: { value: "wage-desc" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(lastAsked().get("order")).toBe("wage-desc");
    const first = document.querySelector("tbody tr");
    expect(first?.textContent).toContain("G-100-24001-000002");
    expect(screen.getByText(/Highest wage first covers every match/)).toBeInTheDocument();
  });

  it("keeps the order a shared or reloaded address asks for", () => {
    // Arrange: a link to a search ordered by the highest wage
    address.params = new URLSearchParams("q=acme&order=wage-desc");
    // Act
    renderIt();
    // Assert: the answer's first row is the higher wage, not the newest filing
    expect(lastAsked().get("order")).toBe("wage-desc");
    const first = document.querySelector("tbody tr");
    expect(first?.textContent).toContain("G-100-24001-000002");
  });

  it("offers the same search as a CSV download", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const link = screen.getByRole("link", { name: /Download CSV \(2 rows\)/ });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/api/case-search?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("format")).toBe("csv");
    expect(q.get("q")).toBe("acme");
    // Nothing but the format differs from the search the page ran.
    q.delete("format");
    const ran = lastAsked();
    ran.delete("s");
    expect(q.toString()).toBe(ran.toString());
  });
});

describe("the reason a control is off", () => {
  it("prints the no-lead sentence once, and each off control still carries a reason", () => {
    const { container } = renderIt();
    const said = (container.textContent ?? "").split("Start with an employer or a case number").length - 1;
    expect(said).toBe(1);
    const city = screen.getByRole("textbox", { name: "Worksite city" });
    expect(city).toBeDisabled();
    const id = city.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toMatch(/law firm/);
  });
});

describe("a long answer comes in short pages, like every other case list", () => {
  // 100 rows at a time with "Show 100 more" made one large employer's answer 14,452px of results on a phone
  // (measured Nov 12 2026). A page is 25 rows on a wide screen and 10 on a phone, with the shared pager and its
  // rows-per-page choice; the CSV still carries the whole answer.
  const many = Array.from({ length: 230 }, (_, i) => row(`G-100-24001-${String(100000 + i).padStart(6, "0")}`));
  const search = () => {
    usePublicQuery.mockImplementation((url: string) =>
      url === "skip" ? { data: undefined, failed: false } : { data: answer({ rows: many, counts: { perm: 230, pwd: 0, lca: 0, seasonal: 0 } }), failed: false },
    );
    renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
  };
  const bodyRows = () => Array.from(document.querySelectorAll("tbody tr"));
  const firstCase = () => bodyRows()[0]?.querySelector("td")?.textContent ?? "";

  it("draws one page, says where it is in the answer, and that the CSV carries all of it", { timeout: 30_000 }, () => {
    search();
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText("1 to 25 of 230 filings")).toBeInTheDocument();
    expect(screen.getByText(/The CSV download carries all 230\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show \d+ more$/ })).toBeNull();
  });

  it("turns the page with the pager, and the phone's list turns with the table", { timeout: 30_000 }, () => {
    search();
    const before = firstCase();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(bodyRows()).toHaveLength(25);
    expect(firstCase()).not.toBe(before);
    expect(screen.getByText("26 to 50 of 230 filings")).toBeInTheDocument();
    // The phone's list is the same page of the same answer.
    expect(document.querySelectorAll("ul.sm\\:hidden > li")).toHaveLength(25);
  });

  it("takes a rows-per-page choice and starts again from the first page", { timeout: 30_000 }, () => {
    search();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "100 rows per page" }));
    expect(bodyRows()).toHaveLength(100);
    expect(screen.getByText("1 to 100 of 230 filings")).toBeInTheDocument();
  });

  it("goes back to the first page when the question changes", { timeout: 30_000 }, () => {
    search();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("26 to 50 of 230 filings")).toBeInTheDocument();
    // The stage chips ask a different question of the same answer: every row here is decided.
    fireEvent.click(within(screen.getByRole("group", { name: "Which stage" })).getByRole("button", { name: "Decided" }));
    expect(screen.getByText("1 to 25 of 230 filings")).toBeInTheDocument();
  });
});

describe("the pages a name can also mean", () => {
  it("lists the employer, law firm and job pages beside the filings, and the site's own pages", async () => {
    const suggestions = [
      { kind: "employer", name: "Acme Corp", href: "/perm-employers/acme-corp", cases: 812, score: 1, published: true },
      { kind: "attorney", name: "Acme Law LLP", href: "/perm-attorneys/acme-law", cases: 40, score: 0.9, published: true },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith("/api/suggest")
        ? new Response(JSON.stringify({ suggestions, warming: [] }))
        : new Response("{}", { status: 404 }),
    );
    try {
      renderIt();
      fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
      fireEvent.submit(screen.getByLabelText("Employer or case number").closest("form")!);
      expect(await screen.findByRole("heading", { name: "Pages with this name" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Acme Corp/ })).toHaveAttribute("href", "/perm-employers/acme-corp");
      expect(screen.getByRole("heading", { name: "Law firms" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Jobs" })).toBeNull();
      expect(fetchSpy.mock.calls.some((c) => String(c[0]) === "/api/suggest?kind=all&q=acme")).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("asks for no names when the box holds a case number", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      renderIt();
      fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "G-100-24001-000002" } });
      fireEvent.submit(screen.getByLabelText("Employer or case number").closest("form")!);
      expect(screen.queryByRole("heading", { name: "Pages with this name" })).toBeNull();
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("/api/suggest"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("a law firm's page handing over its name", () => {
  it("fills the firm box from ?firm= and searches by it at once", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      useSearchParams: () => new URLSearchParams({ firm: "Fragomen" }),
      useRouter: () => ({ push: vi.fn() }),
    }));
    try {
      const { UnifiedCaseSearch: Fresh } = await import("../UnifiedCaseSearch");
      render(<Fresh fieldOptions={OPTIONS} />);
      expect(screen.getByDisplayValue("Fragomen")).toBeInTheDocument();
      expect(lastAsked().get("firm")).toBe("Fragomen");
    } finally {
      vi.doUnmock("next/navigation");
    }
  });
});

describe("the results on a phone", () => {
  it("lists each filing as its number, status, employer and dates", () => {
    const { container } = renderIt();
    fireEvent.change(screen.getByLabelText("Employer or case number"), { target: { value: "acme" } });
    fireEvent.submit(screen.getByLabelText("Employer or case number").closest("form")!);
    const list = container.querySelector("ul.sm\\:hidden");
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll(":scope > li");
    expect(items).toHaveLength(2);
    const text = [...items].map((li) => li.textContent).join("|");
    expect(text).toContain("A-19001-00001");
    expect(text).toContain("filed 2019-01-02, decided 2019-06-01");
    expect(text).toContain("ACME CORP, Engineer");
  });
});

describe("the overview's place on the page", () => {
  // First things first: the search box, then the overview, then the rest. The four programs' counts are the
  // page's overview. They sat under the example of an answer, a screen further down.
  const overview = <p data-testid="overview">8,055,399 filings, four programs</p>;
  const order = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("with nothing searched, comes straight after the search form and before the example of an answer", () => {
    // Arrange: an empty address, so no search has run.
    address.params = new URLSearchParams();

    // Act
    render(<UnifiedCaseSearch fieldOptions={OPTIONS} overview={overview} />);

    // Assert: the form's own button, then the overview, then the example.
    const button = screen.getAllByRole("button", { name: /search/i })[0]!;
    const shown = screen.getByTestId("overview");
    const example = screen.getByText("One row per case, from every program");
    expect(order(button, shown)).toBe(true);
    expect(order(shown, example)).toBe(true);
  });

  it("with a search run, follows the results: the answer to the search comes first", () => {
    // Arrange: an address that carries a search, and its answer.
    address.params = new URLSearchParams("q=acme");

    // Act
    render(<UnifiedCaseSearch fieldOptions={OPTIONS} overview={overview} />);

    // Assert: a result's row comes before the overview, and the overview is still on the page.
    const result = screen.getAllByText("G-100-24001-000002")[0]!;
    expect(order(result, screen.getByTestId("overview"))).toBe(true);
  });
});

