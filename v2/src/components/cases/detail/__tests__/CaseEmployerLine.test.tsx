import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CaseEmployerLine, employerLineParts, useEmployerPage } from "../CaseEmployerLine";

const EMPLOYER = {
  name: "FMR LLC",
  slug: "fmr-llc",
  url: "https://permtracker.app/perm-employers/fmr-llc",
  page: "perm" as const,
  perm: { published: 1240, certified: 1200, denied: 12, certifiedShare: 0.99, pending: 56, newestFiling: "2026-11-18", filingsLast12Months: 300 },
  h1bLcas: 3456,
  wageRequests: 2370,
};

function Probe({ name }: { name: string }) {
  return <CaseEmployerLine employer={useEmployerPage(name)} />;
}

const answer = (match: string) =>
  vi.fn(async () => new Response(JSON.stringify({ data: { query: "FMR LLC", shareFloor: 10, match, employer: match === "none" ? null : EMPLOYER } })));

describe("the case page's employer line", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("links an exact match to its employer page and says what DOL's files show", async () => {
    const fetch = answer("exact");
    vi.stubGlobal("fetch", fetch);
    render(<Probe name="FMR LLC" />);
    const link = await screen.findByRole("link", { name: "FMR LLC on PERM Tracker" });
    expect(link).toHaveAttribute("href", "/perm-employers/fmr-llc");
    expect(String(fetch.mock.calls[0]![0])).toBe("/v1/lookup/employer?name=FMR%20LLC");
    expect(link.parentElement).toHaveTextContent("1,240 PERM cases DOL decided, 99% of them certified. 56 still waiting at DOL. 2,370 wage requests. 3,456 LCAs.");
  });

  it("shows nothing for a near match, which can be another company, or when the lookup fails", async () => {
    vi.stubGlobal("fetch", answer("possible"));
    const { container, unmount } = render(<Probe name="FMR" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));
    const second = render(<Probe name="FMR LLC" />);
    await waitFor(() => expect(second.container).toBeEmptyDOMElement());
  });

  it("leaves out the parts the record doesn't have", () => {
    expect(employerLineParts({ ...EMPLOYER, perm: { ...EMPLOYER.perm, published: 0, pending: null, certifiedShare: null }, h1bLcas: null, wageRequests: 1 })).toEqual([
      "1 wage request",
    ]);
  });
});
