import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListPages, PHONE_NAMES } from "../list-pages";

const phone = (matches: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: matches && q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
const at = (search: string) => window.history.replaceState(null, "", `/names${search}`);
const rule = (container: HTMLElement) => container.querySelector("style")?.innerHTML ?? "";

afterEach(() => {
  vi.unstubAllGlobals();
  at("");
});

describe("pages for a server-rendered list of names", () => {
  it("draws the first page at the wide size with a phone's shorter page in a media rule, so a phone never paints 200", () => {
    phone(false);
    const { container } = render(<ListPages listId="names" total={950} noun="employers" />);

    expect(rule(container)).toContain("#names > :nth-child(n+201) { display: none; }");
    expect(rule(container)).toContain(`@media (max-width: 639px) { #names > :nth-child(n+${PHONE_NAMES + 1}) { display: none; } }`);
    expect(screen.getByText("1 to 200 of 950 employers")).toBeInTheDocument();
  });

  it("pages by the phone's size on a phone", () => {
    phone(true);
    render(<ListPages listId="names" total={950} noun="employers" />);

    expect(screen.getByText(`1 to ${PHONE_NAMES} of 950 employers`)).toBeInTheDocument();
    expect(screen.getByText(`Page 1 of ${Math.ceil(950 / PHONE_NAMES)}`)).toBeInTheDocument();
  });

  it("shows the page in the address, between its first and last name", () => {
    phone(false);
    at("?page=3");
    const { container } = render(<ListPages listId="names" total={950} noun="employers" />);

    expect(rule(container)).toBe("#names > :nth-child(-n+400), #names > :nth-child(n+601) { display: none; }");
  });

  it("takes the reader's own size, from the first page, with no media rule left over", () => {
    phone(true);
    at("?page=2");
    const { container } = render(<ListPages listId="names" total={950} noun="employers" />);

    act(() => fireEvent.click(screen.getByRole("button", { name: "100 rows per page" })));

    expect(window.location.search).toBe("?per=100");
    expect(rule(container)).toBe("#names > :nth-child(n+101) { display: none; }");
    expect(screen.getByText("1 to 100 of 950 employers")).toBeInTheDocument();
  });

  it("keeps a list's own shorter page, and offers it among the sizes", () => {
    phone(true);
    render(<ListPages listId="reviews" total={40} perPage={12} noun="reviews" />);

    expect(screen.getByText("1 to 12 of 40 reviews")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "12 rows per page" })).toHaveAttribute("aria-pressed", "true");
  });

  it("pages taller items by their own phone size, and shows the pager on a phone only when a wide page holds them all", () => {
    phone(false);
    const { container } = render(<ListPages listId="states" total={55} perPage={60} phonePerPage={20} paramKey="states" noun="states" />);

    expect(rule(container)).toContain("@media (max-width: 639px) { #states > :nth-child(n+21) { display: none; } }");
    expect(container.querySelector("nav")?.closest(".sm\\:hidden")).not.toBeNull();
  });

  it("keeps its page under its own key, so two paged lists on one page don't move each other", () => {
    phone(true);
    at("?states=2");
    render(
      <>
        <ListPages listId="states" total={55} perPage={60} phonePerPage={20} paramKey="states" noun="states" />
        <ListPages listId="names" total={950} noun="employers" />
      </>,
    );

    expect(screen.getByText("21 to 40 of 55 states")).toBeInTheDocument();
    expect(screen.getByText(`1 to ${PHONE_NAMES} of 950 employers`)).toBeInTheDocument();
  });

  it("opens the page that holds a linked item, so the link never lands on a hidden row", () => {
    phone(false);
    at("#entry-75");
    Element.prototype.scrollIntoView = vi.fn();
    const list = document.createElement("ol");
    list.id = "entries";
    for (let i = 1; i <= 120; i++) {
      const li = document.createElement("li");
      li.id = `entry-${i}`;
      list.appendChild(li);
    }
    document.body.appendChild(list);
    try {
      render(<ListPages listId="entries" total={120} perPage={25} noun="changes" />);
      expect(screen.getByText("51 to 75 of 120 changes")).toBeInTheDocument();
    } finally {
      list.remove();
    }
  });

  it("draws nothing for a list shorter than any page", () => {
    phone(false);
    const { container } = render(<ListPages listId="names" total={9} perPage={12} noun="reviews" />);

    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });
});
