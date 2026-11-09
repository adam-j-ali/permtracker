import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CaseLookupForm } from "../CaseLookupForm";

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
      return new Response(JSON.stringify({ cases: [], capped: false }), { status: 200 });
    }));
    render(<CaseLookupForm employerName="Acme Robotics, Inc." searchHref="/case-search?q=acme" searchLabel="Find it among their filings" />);
    fireEvent.click(screen.getByRole("button", { name: "Find it by employer and filing date" }));
    expect(await screen.findByRole("textbox", { name: "Employer’s name" })).toHaveValue("Acme Robotics, Inc.");
    fireEvent.change(screen.getByLabelText("Date it was filed"), { target: { value: "2026-01-30" } });
    await waitFor(() => expect(asked).toContain("/api/filed-on?day=2026-01-30&program=perm"));
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
