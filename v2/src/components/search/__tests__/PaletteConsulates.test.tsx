// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConsulateList } from "@/lib/search/consulateList";

import { SearchPalette } from "../SearchPalette";

/** Consulates in the site search (Batch 5, Nov 25 2026): typing a consulate's city finds its page. */

const CONSULATES = [
  { label: "Mumbai: immigrant visas", href: "/consular-posts/mumbai", keywords: "Mumbai consulate embassy" },
  { label: "Montreal: immigrant visas", href: "/consular-posts/montreal", keywords: "Montreal consulate embassy" },
];
const noop = () => {};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      String(url) === "/consulates.json"
        ? Promise.resolve(new Response(JSON.stringify(CONSULATES)))
        : new Promise<Response>(() => {}),
    ),
  );
});
afterEach(() => {
  resetConsulateList();
  vi.unstubAllGlobals();
});

describe("consulates in the site search", () => {
  it("finds a consulate's page by its city", async () => {
    const user = userEvent.setup();
    render(<SearchPalette open onOpenChange={noop} />);
    await user.type(screen.getByRole("combobox"), "mumbai");
    expect(await screen.findByRole("option", { name: "Mumbai: immigrant visas" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Montreal: immigrant visas" })).toBeNull();
  });

  it("lists no consulates before anything is typed", async () => {
    render(<SearchPalette open onOpenChange={noop} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("option", { name: /immigrant visas/ })).toBeNull();
  });
});
