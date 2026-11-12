import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CaseLookupForm } from "../CaseLookupForm";
import { FinderDock, FinderDockPanel } from "../FinderDock";

// The finder loads when it's first opened. Loaded here once, so no test's wait depends on how long
// the first import of it takes on a busy machine.
await import("../CaseFinder");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CaseLookupForm", () => {
  it("submits the number to the case page as a plain GET", () => {
    const { container } = render(<CaseLookupForm />);
    const form = container.querySelector("form");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/perm-case-status");
  });

  it("offers the employer search to someone without the number", () => {
    render(<CaseLookupForm />);
    const link = screen.getByRole("link", { name: "Search every filing by employer" });
    expect(link.getAttribute("href")).toBe("/case-search");
  });

  it("opens the finder in place for someone without the number, outside the form", async () => {
    const { container } = render(<CaseLookupForm source="faq" />);
    const opener = screen.getByRole("button", { name: "Find it by employer and filing date" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Find your case without the number" })).toBeNull();

    fireEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    const heading = await screen.findByRole("region", { name: "Find your case without the number" });
    // Its boxes are never sent with the number, and Enter in them submits nothing.
    expect(container.querySelector("form")?.contains(heading)).toBe(false);
    expect(container.querySelector("form")?.querySelectorAll("input")).toHaveLength(1);
    expect(document.getElementById(opener.getAttribute("aria-controls") ?? "")?.contains(heading)).toBe(true);

    fireEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Find your case without the number" })).toBeNull();
  });

  it("opens the finder with the employer's name on that employer's page", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ program: "perm", asked: { employer: "Acme Robotics, Inc.", title: "", firm: "" }, by: "index", cases: [], matched: 0, capped: false, close: [], firmUnknown: false, decidedOnly: false }), { status: 200 });
    }));
    render(<CaseLookupForm employerName="Acme Robotics, Inc." searchHref="/case-search?q=acme" searchLabel="Find it among their filings" />);
    fireEvent.click(screen.getByRole("button", { name: "Find it by employer and filing date" }));
    expect(await screen.findByRole("textbox", { name: "Employer’s name" })).toHaveValue("Acme Robotics, Inc.");
    // The name alone is already an ask: the employer's filings, the newest first. A date narrows them to its day.
    await waitFor(() => expect(asked).toContain("/api/find-case?program=perm&employer=Acme+Robotics%2C+Inc."));
    fireEvent.change(screen.getByLabelText("Filed from"), { target: { value: "2026-01-30" } });
    await waitFor(() => expect(asked).toContain("/api/find-case?program=perm&employer=Acme+Robotics%2C+Inc.&from=2026-01-30"));
    expect(screen.getByRole("link", { name: "Find it among their filings" })).toHaveAttribute("href", "/case-search?q=acme");
  });

  it("opens the finder on the kind of filing its page lists", async () => {
    render(<CaseLookupForm finderProgram="lca" />);
    fireEvent.click(screen.getByRole("button", { name: "Find it by employer and filing date" }));
    expect(await screen.findByRole("button", { name: "H-1B LCA" })).toHaveAttribute("aria-pressed", "true");
  });

  it("gives each way in without the number its own full-height target", () => {
    render(<CaseLookupForm />);
    // In one sentence the two sat on touching lines on a phone, and the deploy's phone sweep refuses a 20px target.
    const opener = screen.getByRole("button", { name: "Find it by employer and filing date" });
    const search = opener.parentElement!.querySelector("a")!;
    for (const way of [opener, search]) expect(way.className).toMatch(/\bmin-h-11\b/);
    expect(opener.parentElement!.textContent).toMatch(/number\? Find it by employer and filing date \S/);
  });

  it("leaves the whole no-number line off where its host says so", () => {
    render(<CaseLookupForm searchHref={null} />);
    expect(screen.queryByText(/Don.t have the number/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Find it by employer and filing date" })).toBeNull();
  });
});

/**
 * One finder, three places to open: flat in a box's foot, as its own card on a bare page, and in a header's dock
 * when the box is a narrow side column. A box never holds a second frame.
 */
describe("where the finder opens", () => {
  it("opens flat inside a box's tinted foot, with no second frame", async () => {
    render(
      <div className="object p-5">
        <CaseLookupForm boxed />
      </div>,
    );
    const opener = screen.getByRole("button", { name: "Find it by employer and filing date" });
    // The foot reaches the box's edges on the tint, and asks its question as a label.
    const foot = opener.closest("div")!;
    expect(foot.className).toMatch(/\bbg-tint\b/);
    expect(foot.className).toMatch(/(^|\s)-mx-5(\s|$)/);
    expect(screen.getByText(/Don.t have the number\?/).className).toMatch(/\bfont-semibold\b/);
    fireEvent.click(opener);
    const finder = await screen.findByRole("region", { name: "Find your case without the number" });
    expect(foot.contains(finder)).toBe(true);
    expect(finder.className).not.toMatch(/\bbg-card\b/);
    expect(finder.className).not.toMatch(/(^|\s)border-2(\s|$)/);
  });

  it("stands as its own card when the form stands free on a page", async () => {
    render(<CaseLookupForm />);
    const opener = screen.getByRole("button", { name: "Find it by employer and filing date" });
    expect(opener.closest("div")!.className).not.toMatch(/\bbg-tint\b/);
    fireEvent.click(opener);
    const finder = await screen.findByRole("region", { name: "Find your case without the number" });
    expect(finder.className).toMatch(/\bbg-card\b/);
  });

  it("opens in the header's dock when the box is a side column, outside the box and at the page's width", async () => {
    render(
      <FinderDock>
        <div data-testid="side" className="object p-5">
          <CaseLookupForm boxed finderProgram="lca" />
        </div>
        <FinderDockPanel className="mt-6" />
      </FinderDock>,
    );
    const opener = screen.getByRole("button", { name: "Find it by employer and filing date" });
    const panel = document.getElementById(opener.getAttribute("aria-controls") ?? "")!;
    expect(panel).not.toBeNull();
    expect(panel.hidden).toBe(true);
    expect(panel.className).toBe("");
    expect(screen.getByTestId("side").contains(panel)).toBe(false);

    fireEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    const finder = await screen.findByRole("region", { name: "Find your case without the number" });
    expect(panel.contains(finder)).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.className).toMatch(/\bmt-6\b/);
    expect(screen.getByTestId("side").contains(finder)).toBe(false);
    // Out of the box it is a card again, and it still opens on the box's own kind of filing.
    expect(finder.className).toMatch(/\bbg-card\b/);
    expect(await screen.findByRole("button", { name: "H-1B LCA" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(panel.hidden).toBe(true);
    expect(screen.queryByRole("region", { name: "Find your case without the number" })).toBeNull();
  });

  it("lists a host's own ways in after the two every box offers, then a quiet last line", () => {
    render(<CaseLookupForm boxed more={[{ href: "#follow", label: "Follow this employer by email" }]} footnote="Free, and no account needed." />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Search every filing by employer", "Follow this employer by email"]);
    // In a box each way is a row as wide as the box, a full-height target, the finder first and heavier.
    const opener = screen.getByRole("button", { name: "Find it by employer and filing date" });
    for (const row of [opener, ...links]) {
      expect(row.className).toMatch(/\bmin-h-11\b/);
      expect(row.className).toMatch(/\bw-full\b/);
    }
    expect(opener.className).toMatch(/\bfont-semibold\b/);
    for (const a of links) expect(a.className).not.toMatch(/\bfont-semibold\b/);
    const rows = [...opener.closest("ul")!.querySelectorAll("li")].map((li) => li.textContent?.trim());
    expect(rows).toEqual(["Find it by employer and filing date", "Search every filing by employer", "Follow this employer by email"]);
    expect(screen.getByText("Free, and no account needed.")).toBeInTheDocument();
  });
});

/**
 * A case box's button was pressed with nothing typed about 600 times in 30 days (to Nov 10 2026), on employer pages
 * more often than it was used properly. The box showed a whole example number as its placeholder in the muted text
 * colour, which reads as a number already typed; the homepage's box, whose placeholder is words, saw 1% empty presses.
 */
describe("a case box with nothing typed", () => {
  const box = () => screen.getByRole("textbox") as HTMLInputElement;

  it("shows words in the empty box, never a whole example number", () => {
    render(<CaseLookupForm />);
    expect(box().placeholder).toBe("Case number");
    expect(box().placeholder).not.toMatch(/\d{5}/);
    cleanup();
    render(<CaseLookupForm names label="Case number or employer" />);
    expect(box().placeholder).toBe("Case number or employer");
  });

  it("gives the example under the box, where it can't be taken for a number already typed", () => {
    // The example was the placeholder, and left the page with it. A first-time visitor still needs to see the shape.
    render(<CaseLookupForm />);
    expect(screen.getByText(/It's on your ETA-9089 receipt\./).textContent).toMatch(/A case number looks like G-100-26125-868956\.$/);
    cleanup();
    render(<CaseLookupForm example="P-100-26140-123456" help="It's on your ETA-9141." />);
    expect(screen.getByText(/It's on your ETA-9141\./).textContent).toMatch(/A case number looks like P-100-26140-123456\.$/);
    cleanup();
    // A box that also takes a name says so in its own words: an example number alone would say names aren't taken.
    render(<CaseLookupForm names label="Case number or employer" />);
    expect(screen.queryByText(/A case number looks like/)).toBeNull();
  });

  it("is required, so the browser keeps an empty press in the box, with or without scripts", () => {
    render(<CaseLookupForm />);
    expect(box().required).toBe(true);
    expect(box().checkValidity()).toBe(false);
  });

  it("says what to type in its own words, and clears that the moment something is typed", () => {
    render(<CaseLookupForm />);
    fireEvent.invalid(box());
    expect(box().validationMessage).toBe("Type your case number first.");
    fireEvent.input(box(), { target: { value: "G-100-26125-868956" } });
    expect(box().validationMessage).toBe("");
    expect(box().checkValidity()).toBe(true);
    cleanup();
    render(<CaseLookupForm names />);
    fireEvent.invalid(box());
    expect(box().validationMessage).toBe("Type a case number or an employer's name first.");
  });

  it("gives the example of its own kind of number when the typed one is the wrong shape", () => {
    render(<CaseLookupForm example="P-100-26140-123456" />);
    fireEvent.change(box(), { target: { value: "12345" } });
    expect(screen.getByText(/They look like P-100-26140-123456\./)).toBeTruthy();
    cleanup();
    render(<CaseLookupForm />);
    fireEvent.change(box(), { target: { value: "12345" } });
    expect(screen.getByText(/They look like G-100-26125-868956\./)).toBeTruthy();
  });
});
