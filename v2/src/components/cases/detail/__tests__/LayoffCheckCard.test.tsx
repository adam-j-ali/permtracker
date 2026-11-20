import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LayoffCheckCard } from "../LayoffCheckCard";

const EMPLOYER = {
  name: "Acme Corp",
  slug: "acme-corp",
  url: "https://permtracker.app/perm-employers/acme-corp",
  page: "perm" as const,
  perm: { published: 10, certified: 9, denied: 1, certifiedShare: 0.9, pending: 2, newestFiling: "2026-03-31", filingsLast12Months: 4 },
  h1bLcas: null,
  wageRequests: null,
};
const notice = {
  id: "n1",
  state: "CA",
  noticeDate: "2026-01-15",
  effectiveDate: null,
  company: "Acme Corp",
  kind: "Layoff",
  employees: 60,
  county: "Santa Clara",
  industry: null,
  employerSlug: "acme-corp",
  sourceUrl: "https://edd.ca.gov/warn",
  site: null,
};
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("the layoff check", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the six months before the ETA 9089's filing day and lists what it finds", async () => {
    const fetch = answer({ notices: [notice] });
    vi.stubGlobal("fetch", fetch);
    render(<LayoffCheckCard employer={EMPLOYER} eta9089FilingDate="2026-03-31" />);
    expect(await screen.findByText(/1 WARN notice from Acme Corp is dated/)).toHaveTextContent("the six months before this case's filing");
    expect(String(fetch.mock.calls[0]![0])).toBe("/api/warn-notices?slug=acme-corp&from=2025-09-30&to=2026-03-31");
    expect(screen.getByRole("link", { name: /California WARN report/ })).toHaveAttribute("href", "https://edd.ca.gov/warn");
    expect(screen.getByText(/20 CFR 656.17\(k\)/)).toBeInTheDocument();
  });

  it("says plainly when there are none, and when they couldn't be read", async () => {
    vi.stubGlobal("fetch", answer({ notices: [] }));
    const none = render(<LayoffCheckCard employer={EMPLOYER} />);
    expect(await screen.findByText(/No WARN notice from Acme Corp is dated/)).toHaveTextContent("the six months before a filing today");
    none.unmount();
    vi.stubGlobal("fetch", answer({ error: "x" }, 503));
    render(<LayoffCheckCard employer={EMPLOYER} />);
    expect(await screen.findByText(/couldn't be read just now/)).toBeInTheDocument();
  });

  it("shows nothing without an employer page to match notices to", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<LayoffCheckCard employer={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetch).not.toHaveBeenCalled();
  });
});
