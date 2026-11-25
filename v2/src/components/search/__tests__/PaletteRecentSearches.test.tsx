// @vitest-environment jsdom
/**
 * Recent searches in both palettes: offered before anything is typed, with Clear; kept when a search is made, and
 * only then; and the signed-in app's pages left out of the public palette.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQuery(...args) }));

import { SearchPalette } from "../SearchPalette";
import { AppSearchPalette } from "../AppSearchPalette";
import { RECENT_SEARCHES_KEY, readRecentSearches } from "@/lib/search/recentSearches";

const T0 = Date.UTC(2026, 10, 23, 17, 0, 0);
const noop = () => {};

function seed(list: Array<{ label: string; href: string }>) {
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.map((s, i) => ({ ...s, at: T0 - i * 1000 }))));
}

const recentGroup = () => screen.queryByRole("group", { name: "Recent searches" });

describe("the site palette's recent searches", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The articles and the corpus lookup never answer: only the recent list is under test.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("offers them first while nothing is typed, and says how many", () => {
    seed([
      { label: "Acme Robotics", href: "/perm-employers/acme-robotics" },
      { label: "G-100-26125-868956", href: "/perm-case-status?case=G-100-26125-868956" },
    ]);
    render(<SearchPalette open onOpenChange={noop} />);

    const group = recentGroup()!;
    expect(within(group).getAllByRole("option").map((o) => o.textContent?.trim())).toEqual(["Acme Robotics", "G-100-26125-868956"]);
    expect(screen.getByRole("button", { name: "Clear recent searches" })).toBeInTheDocument();
    expect(screen.getByText("2 recent searches.")).toBeInTheDocument();
  });

  it("leaves out pages of the signed-in app", () => {
    seed([
      { label: "Initech", href: "/cases?search=Initech" },
      { label: "Globex", href: "/case-search?q=Globex" },
    ]);
    render(<SearchPalette open onOpenChange={noop} />);

    expect(within(recentGroup()!).getAllByRole("option").map((o) => o.textContent?.trim())).toEqual(["Globex"]);
  });

  it("puts them away while something is typed", async () => {
    seed([{ label: "Acme Robotics", href: "/perm-employers/acme-robotics" }]);
    const user = userEvent.setup();
    render(<SearchPalette open onOpenChange={noop} />);

    await user.type(screen.getByRole("combobox"), "visa");
    expect(recentGroup()).toBeNull();
  });

  it("clears them, says so, and goes back to the box", async () => {
    seed([{ label: "Acme Robotics", href: "/perm-employers/acme-robotics" }]);
    const user = userEvent.setup();
    render(<SearchPalette open onOpenChange={noop} />);

    await user.click(screen.getByRole("button", { name: "Clear recent searches" }));

    expect(recentGroup()).toBeNull();
    expect(window.localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    expect(screen.getByText("Recent searches cleared.")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("keeps a case number typed and opened, in its own shape", async () => {
    const user = userEvent.setup();
    render(<SearchPalette open onOpenChange={noop} />);

    await user.type(screen.getByRole("combobox"), "g10026125868956");
    await user.click(screen.getByRole("option", { name: /Check case G-100-26125-868956/ }));

    expect(readRecentSearches()).toMatchObject([
      { label: "G-100-26125-868956", href: "/perm-case-status?case=G-100-26125-868956" },
    ]);
  });

  it("offers a USCIS receipt its own row, and never keeps it among recent searches (Nov 25 2026)", async () => {
    const user = userEvent.setup();
    render(<SearchPalette open onOpenChange={noop} />);

    await user.type(screen.getByRole("combobox"), "lin 2604214850");
    const row = screen.getByRole("option", { name: /Look up USCIS receipt LIN2604214850/ });
    await user.click(row);

    expect(readRecentSearches()).toEqual([]);
  });

  it("keeps a page found by typing, and not a page picked with nothing typed", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SearchPalette open onOpenChange={noop} />);

    const firstPage = within(screen.getByRole("group", { name: "Go to" })).getAllByRole("option")[0]!;
    await user.click(firstPage);
    expect(readRecentSearches()).toEqual([]);
    unmount();

    render(<SearchPalette open onOpenChange={noop} />);
    await user.type(screen.getByRole("combobox"), "visa bulletin");
    const found = screen.getAllByRole("option").find((o) => /visa bulletin/i.test(o.textContent ?? ""))!;
    await user.click(found);
    expect(readRecentSearches()).toHaveLength(1);
    expect(readRecentSearches()[0]!.label).toBe(found.textContent?.trim());
  });
});

describe("the app palette's recent searches", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useQuery.mockReset();
    useQuery.mockReturnValue(undefined);
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("offers every recent search, the app's own pages included, with Clear", () => {
    seed([
      { label: "Initech", href: "/cases?search=Initech" },
      { label: "Globex", href: "/case-search?q=Globex" },
    ]);
    render(<AppSearchPalette open onOpenChange={noop} />);

    expect(within(recentGroup()!).getAllByRole("option").map((o) => o.textContent?.trim())).toEqual(["Initech", "Globex"]);
    expect(screen.getByRole("button", { name: "Clear recent searches" })).toBeInTheDocument();
  });

  it("keeps a case found by the employer's name, never the worker's", async () => {
    useQuery.mockReturnValue({
      cases: [
        { _id: "c1", employerName: "Juniper Biologics", positionTitle: "Senior Statistician", beneficiaryIdentifier: "A. Lindqvist", progressStatus: "working" },
      ],
      pagination: { totalCount: 1 },
    });
    const user = userEvent.setup();
    render(<AppSearchPalette open onOpenChange={noop} />);

    await user.type(screen.getByPlaceholderText(/case number/i), "lindqvist");
    await user.click(screen.getByRole("option", { name: /Juniper Biologics/ }));

    expect(readRecentSearches()).toMatchObject([{ label: "Juniper Biologics", href: "/cases/c1" }]);
    expect(window.localStorage.getItem(RECENT_SEARCHES_KEY)).not.toContain("Lindqvist");
  });
});
