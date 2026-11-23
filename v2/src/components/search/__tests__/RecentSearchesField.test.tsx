/**
 * Recent searches under a search box: shown when the box has focus and nothing typed, kept when a search is made,
 * cleared on request, reachable by keyboard and said to a screen reader.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { RecentSearchesField } from "../RecentSearches";
import { RECENT_SEARCHES_KEY, readRecentSearches } from "@/lib/search/recentSearches";

const T0 = Date.UTC(2026, 10, 23, 17, 0, 0);

function seed(list: Array<{ label: string; href: string }>) {
  window.localStorage.setItem(
    RECENT_SEARCHES_KEY,
    JSON.stringify(list.map((s, i) => ({ ...s, at: T0 - i * 1000 }))),
  );
}

const panel = () => screen.queryByRole("list", { name: "Recent searches" });
/** What the box's polite live region says (no status role, so a page's own status line stays the only one). */
const spoken = () => {
  const region = document.querySelector("[data-recent-status]");
  expect(region).toHaveAttribute("aria-live", "polite");
  expect(region).not.toHaveAttribute("role");
  return region;
};

describe("recent searches under a box", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("lists them when the empty box has focus, and says how many", async () => {
    seed([
      { label: "Acme Robotics", href: "/case-search?q=Acme+Robotics" },
      { label: "G-100-26125-868956", href: "/perm-case-status?case=G-100-26125-868956" },
    ]);
    const user = userEvent.setup();
    render(
      <RecentSearchesField>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );

    expect(panel()).toBeNull();
    await user.click(screen.getByRole("textbox", { name: "Search" }));

    const list = panel()!;
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.textContent?.trim())).toEqual(["Acme Robotics", "G-100-26125-868956"]);
    expect(links[0]).toHaveAttribute("href", "/case-search?q=Acme+Robotics");
    expect(screen.getByRole("button", { name: "Clear recent searches" })).toBeInTheDocument();
    expect(spoken()).toHaveTextContent("2 recent searches below the box.");
  });

  it("hides them while something is typed, and offers them again once the box is empty", async () => {
    seed([{ label: "Acme Robotics", href: "/case-search?q=Acme+Robotics" }]);
    const user = userEvent.setup();
    render(
      <RecentSearchesField>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );
    const box = screen.getByRole("textbox", { name: "Search" });

    await user.click(box);
    await user.type(box, "Glo");
    expect(panel()).toBeNull();
    await user.clear(box);
    expect(panel()).not.toBeNull();
  });

  it("shows nothing when there's nothing to offer", async () => {
    const user = userEvent.setup();
    render(
      <RecentSearchesField>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );

    await user.click(screen.getByRole("textbox", { name: "Search" }));
    expect(panel()).toBeNull();
    expect(spoken()).toHaveTextContent("");
  });

  it("clears them, says so, and leaves focus in the box", async () => {
    seed([{ label: "Acme Robotics", href: "/case-search?q=Acme+Robotics" }]);
    const user = userEvent.setup();
    render(
      <RecentSearchesField>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );
    const box = screen.getByRole("textbox", { name: "Search" });

    await user.click(box);
    await user.tab();
    expect(screen.getByRole("button", { name: "Clear recent searches" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(panel()).toBeNull();
    expect(window.localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    expect(spoken()).toHaveTextContent("Recent searches cleared.");
    expect(box).toHaveFocus();
  });

  it("moves into the list with the arrow keys and closes on Escape", async () => {
    seed([
      { label: "Acme Robotics", href: "/case-search?q=Acme+Robotics" },
      { label: "Globex", href: "/case-search?q=Globex" },
    ]);
    const user = userEvent.setup();
    render(
      <RecentSearchesField>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );
    const box = screen.getByRole("textbox", { name: "Search" });

    await user.click(box);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "Acme Robotics" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "Globex" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(box).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(panel()).toBeNull();
  });

  it("keeps a search when its form is sent, at the address the form sends it to", () => {
    render(
      <form method="get" action="/perm-employers#all">
        <RecentSearchesField record="submit">
          <input aria-label="Search" name="q" defaultValue="  acme   robotics " />
        </RecentSearchesField>
        <input type="hidden" name="state" value="" />
      </form>,
    );

    fireEvent.submit(screen.getByRole("textbox", { name: "Search" }).closest("form")!);

    expect(readRecentSearches()).toMatchObject([{ label: "acme robotics", href: "/perm-employers?q=acme+robotics#all" }]);
  });

  it("keeps a filter's search on Enter and on leaving the box, at this page with the box's field set", async () => {
    window.history.replaceState(null, "", "/policy-changes?kind=rule&page=2");
    const user = userEvent.setup();
    render(
      <>
        <RecentSearchesField record="filter">
          <input aria-label="Search" />
        </RecentSearchesField>
        <button type="button">Elsewhere</button>
      </>,
    );
    const box = screen.getByRole("textbox", { name: "Search" });

    await user.type(box, "prevailing wage{Enter}");
    expect(readRecentSearches()).toMatchObject([{ label: "prevailing wage", href: "/policy-changes?kind=rule&q=prevailing+wage" }]);

    await user.clear(box);
    await user.type(box, "H-1B");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(readRecentSearches().map((s) => s.label)).toEqual(["H-1B", "prevailing wage"]);
  });

  it("keeps nothing for a box that only offers the list, or for a search it mustn't keep", async () => {
    const user = userEvent.setup();
    render(
      <>
        <RecentSearchesField>
          <input aria-label="Offers only" />
        </RecentSearchesField>
        <RecentSearchesField record="filter">
          <input aria-label="Filter" />
        </RecentSearchesField>
      </>,
    );

    await user.type(screen.getByRole("textbox", { name: "Offers only" }), "Acme{Enter}");
    await user.type(screen.getByRole("textbox", { name: "Filter" }), "jane@example.com{Enter}");
    expect(readRecentSearches()).toEqual([]);
  });

  it("fills a box from a search made on its own page, without loading the page again", async () => {
    window.history.replaceState(null, "", "/debarments");
    seed([{ label: "acme", href: "/debarments?q=acme" }]);
    const user = userEvent.setup();
    function Box() {
      const [q, setQ] = useState("");
      return (
        <RecentSearchesField record="filter" value={q} onRestore={setQ}>
          <input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </RecentSearchesField>
      );
    }
    render(<Box />);
    const box = screen.getByRole("textbox", { name: "Search" });

    await user.click(box);
    const link = screen.getByRole("link", { name: "acme" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });

    expect(click.defaultPrevented).toBe(true);
    expect(box).toHaveValue("acme");
    expect(box).toHaveFocus();
    expect(panel()).toBeNull();
  });

  it("lets a search from another page load that page", async () => {
    window.history.replaceState(null, "", "/debarments");
    seed([{ label: "Globex", href: "/case-search?q=Globex" }]);
    const onRestore = vi.fn();
    const user = userEvent.setup();
    render(
      <RecentSearchesField record="filter" onRestore={onRestore}>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );

    await user.click(screen.getByRole("textbox", { name: "Search" }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole("link", { name: "Globex" }).dispatchEvent(click);
    });

    expect(onRestore).not.toHaveBeenCalled();
    // Next's link takes the click itself; nothing here stops it.
    expect(readRecentSearches()[0]).toMatchObject({ label: "Globex" });
  });

  it("fills the box from the address on arrival, when asked to", () => {
    window.history.replaceState(null, "", "/debarments?q=acme+robotics");
    const onRestore = vi.fn();
    render(
      <RecentSearchesField record="filter" onRestore={onRestore} restoreFromUrl>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );

    expect(onRestore).toHaveBeenCalledWith("acme robotics");
  });

  it("offers a public box no page from the signed-in app, and the app's box every search", async () => {
    seed([
      { label: "Initech", href: "/cases?search=Initech" },
      { label: "Globex", href: "/case-search?q=Globex" },
    ]);
    const user = userEvent.setup();
    render(
      <>
        <RecentSearchesField>
          <input aria-label="Public" />
        </RecentSearchesField>
        <RecentSearchesField scope="app">
          <input aria-label="App" />
        </RecentSearchesField>
      </>,
    );

    await user.click(screen.getByRole("textbox", { name: "Public" }));
    expect(within(panel()!).getAllByRole("link").map((a) => a.textContent?.trim())).toEqual(["Globex"]);
    await user.click(screen.getByRole("textbox", { name: "App" }));
    expect(within(panel()!).getAllByRole("link").map((a) => a.textContent?.trim())).toEqual(["Initech", "Globex"]);
  });

  it("follows a change made in another tab", async () => {
    const user = userEvent.setup();
    render(
      <RecentSearchesField>
        <input aria-label="Search" />
      </RecentSearchesField>,
    );
    await user.click(screen.getByRole("textbox", { name: "Search" }));
    expect(panel()).toBeNull();

    act(() => {
      seed([{ label: "Globex", href: "/case-search?q=Globex" }]);
      window.dispatchEvent(new StorageEvent("storage", { key: RECENT_SEARCHES_KEY }));
    });

    expect(screen.getByRole("link", { name: "Globex" })).toBeInTheDocument();
  });
});
