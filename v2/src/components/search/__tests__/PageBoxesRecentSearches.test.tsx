/**
 * Recent searches in the page boxes people use most: a list page's search (a server-drawn GET form) and the case
 * box. Each offers the list when focused and empty and keeps the search it sends; the case box inside another
 * site's page (the embed) does neither.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IndexSearch } from "@/components/data/IndexHeader";
import { CaseLookupForm } from "@/components/tools/CaseLookupForm";
import { RECENT_SEARCHES_KEY, readRecentSearches } from "@/lib/search/recentSearches";

const T0 = Date.UTC(2026, 10, 23, 17, 0, 0);

function seed(list: Array<{ label: string; href: string }>) {
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.map((s, i) => ({ ...s, at: T0 - i * 1000 }))));
}

const recentList = () => screen.queryByRole("list", { name: "Recent searches" });

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("a list page's search", () => {
  it("offers recent searches under the box, outside its label", async () => {
    seed([{ label: "Acme Robotics", href: "/perm-employers?q=Acme+Robotics#all" }]);
    const user = userEvent.setup();
    render(<IndexSearch title="Find an employer" action="/perm-employers#all" placeholder="Employer name" />);
    const box = screen.getByRole("searchbox", { name: "Find an employer" });

    await user.click(box);

    expect(within(recentList()!).getByRole("link", { name: "Acme Robotics" })).toHaveAttribute(
      "href",
      "/perm-employers?q=Acme+Robotics#all",
    );
    // The box's name is still only its label.
    expect(box).toHaveAccessibleName("Find an employer");
  });

  it("keeps the search it sends, at the page it sends it to", () => {
    render(<IndexSearch title="Find an employer" action="/perm-employers#all" placeholder="Employer name" />);
    const box = screen.getByRole("searchbox", { name: "Find an employer" });

    fireEvent.change(box, { target: { value: "Globex " } });
    fireEvent.submit(box.closest("form")!);

    expect(readRecentSearches()).toMatchObject([{ label: "Globex", href: "/perm-employers?q=Globex#all" }]);
  });
});

describe("the case box", () => {
  it("keeps a case number in its own shape, at the case's page", () => {
    render(<CaseLookupForm />);
    const box = screen.getByRole("textbox", { name: "Your PERM case number" });

    fireEvent.change(box, { target: { value: "g-100-26125-868956" } });
    fireEvent.submit(box.closest("form")!);

    expect(readRecentSearches()).toMatchObject([
      { label: "G-100-26125-868956", href: "/perm-case-status?case=G-100-26125-868956" },
    ]);
  });

  it("never keeps a USCIS receipt number typed into it", () => {
    render(<CaseLookupForm />);
    const box = screen.getByRole("textbox", { name: "Your PERM case number" });

    fireEvent.change(box, { target: { value: "EAC2190123456" } });
    fireEvent.submit(box.closest("form")!);

    expect(window.localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it("offers and keeps nothing inside another site's page", async () => {
    seed([{ label: "Acme Robotics", href: "/perm-employers?q=Acme+Robotics#all" }]);
    const user = userEvent.setup();
    render(<CaseLookupForm action="/embed/case-status" searchHref={null} hiddenFields={{ site: "example.org" }} />);
    const box = screen.getByRole("textbox", { name: "Your PERM case number" });

    await user.click(box);
    expect(recentList()).toBeNull();

    fireEvent.change(box, { target: { value: "G-100-26125-868956" } });
    fireEvent.submit(box.closest("form")!);
    expect(readRecentSearches().map((s) => s.label)).toEqual(["Acme Robotics"]);
  });
});
