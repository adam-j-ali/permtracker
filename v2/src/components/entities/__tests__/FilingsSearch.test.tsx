import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FilingsSearch } from "../FilingsSearch";
import type { FacetRow } from "@/lib/db/entityDetail";

const row = (key: string | null, label: string, n: number, code: string | null = null): FacetRow => ({
  key, label, code, n, certified: n, denied: 0,
});
const JOBS = [row("software-developers", "Software Developers", 4310, "15-1252.00"), row("data-scientists", "Data Scientists", 328, "15-2051.00")];
// The facet's label is DOL's two-letter code, as the nightly build stores it.
const STATES = [row("WA", "WA", 4475), row("CA", "CA", 208), row(null, "Unknown", 3)];

describe("FilingsSearch", () => {
  it("on an employer's page, sends the employer along and narrows by title, job and state", () => {
    render(<FilingsSearch what="the filings of Microsoft Corporation" fixed={{ q: "Microsoft Corporation" }} ask="title" jobs={JOBS} states={STATES} />);
    const form = screen.getByRole("search", { name: "Search the filings of Microsoft Corporation" });
    expect(form.getAttribute("action")).toBe("/case-search");
    expect(form.getAttribute("method")).toBe("get");
    expect(form.querySelector('input[type="hidden"][name="q"]')?.getAttribute("value")).toBe("Microsoft Corporation");
    expect(within(form).getByLabelText(/Job title/).getAttribute("name")).toBe("title");
    const job = within(form).getByLabelText(/Job \(SOC\)/) as HTMLSelectElement;
    expect([...job.options].map((o) => o.value)).toEqual(["", "software-developers", "data-scientists"]);
    // Only real two-letter states, by name and in alphabetical order: the list holds every state the filings name.
    const state = within(form).getByLabelText(/State/) as HTMLSelectElement;
    expect([...state.options].map((o) => o.value)).toEqual(["", "CA", "WA"]);
    expect([...state.options].map((o) => o.textContent)).toEqual(["Any state", "California", "Washington"]);
  });

  it("names its subject without a possessive, so a name ending in s never reads as \"LOGISTICS's\"", () => {
    render(<FilingsSearch what="the filings of MERIT LOGISTICS" fixed={{ q: "MERIT LOGISTICS" }} ask="title" jobs={JOBS} />);
    expect(screen.getByRole("heading", { name: "Search the filings of MERIT LOGISTICS" })).toBeTruthy();
    expect(screen.getByRole("search").getAttribute("aria-label")).toBe("Search the filings of MERIT LOGISTICS");
    expect(document.body.textContent).not.toMatch(/'s filings/);
  });

  it("keeps each program's name whole, so a line never ends on \"CW-\"", () => {
    const { container } = render(<FilingsSearch what="the filings for Software Developers" fixed={{ occupation: "software-developers" }} ask="q" />);
    const whole = [...container.querySelectorAll("p span.whitespace-nowrap")].map((s) => s.textContent);
    expect(whole).toEqual(["H-1B", "H-2A", "H-2B", "CW-1"]);
    // The sentence still reads as one sentence, with its spaces.
    expect(container.querySelector("p")?.textContent).toBe(
      "Case by case, in every program: PERM, wage requests, H-1B, H-2A, H-2B and CW-1.",
    );
  });

  it("puts the employer's own jobs one tap away, each opening that employer's filings for it", () => {
    render(<FilingsSearch what="the filings of Microsoft Corporation" fixed={{ q: "Microsoft Corporation" }} ask="title" jobs={JOBS} />);
    const chip = screen.getByRole("link", { name: /Software Developers/ });
    expect(chip.getAttribute("href")).toBe("/case-search?q=Microsoft+Corporation&occupation=software-developers");
    expect(chip.textContent).toContain("4,310");
  });

  it("lets a long chip wrap inside the card instead of running off a phone's screen", () => {
    const long = row(
      "first-line-supervisors",
      "First-Line Supervisors of Transportation and Material-Moving Workers, Except Aircraft Cargo Handling Supervisors",
      51,
    );
    render(<FilingsSearch what="the filings of Acme" fixed={{ q: "Acme" }} ask="title" jobs={[long]} />);
    const chip = screen.getByRole("link", { name: /First-Line Supervisors/ });
    const item = chip.closest("li");
    // The item may shrink to the list's width, and the chip may not outgrow it.
    expect(item?.className.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "max-w-full"]));
    expect(chip.className.split(" ")).toEqual(expect.arrayContaining(["max-w-full", "flex-wrap"]));
    // Its words wrap: no part of the chip is cut to one line.
    expect(chip.querySelector(".truncate")).toBeNull();
    expect(chip.className).not.toMatch(/\bwhitespace-nowrap\b/);
  });

  it("on a job's page, asks for an employer, offers no job picker, and its chips are the employers filing it", () => {
    const employers = [row("microsoft-corporation", "Microsoft Corporation", 4310)];
    render(<FilingsSearch what="the filings for Software Developers" fixed={{ occupation: "software-developers" }} ask="q" employers={employers} />);
    const form = screen.getByRole("search", { name: "Search the filings for Software Developers" });
    expect(form.querySelector('input[type="hidden"][name="occupation"]')?.getAttribute("value")).toBe("software-developers");
    expect(within(form).getByLabelText(/Employer/).getAttribute("name")).toBe("q");
    expect(within(form).queryByLabelText(/Job \(SOC\)/)).toBeNull();
    expect(screen.getByRole("link", { name: /Microsoft Corporation/ }).getAttribute("href")).toBe(
      "/case-search?occupation=software-developers&q=Microsoft+Corporation",
    );
  });
});
