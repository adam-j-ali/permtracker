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

  it("draws nothing for a list shorter than any page", () => {
    phone(false);
    const { container } = render(<ListPages listId="names" total={9} perPage={12} noun="reviews" />);

    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });
});
