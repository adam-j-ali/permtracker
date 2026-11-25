// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ analytics: { capture } }));

import { resetArticleList } from "@/lib/search/articleList";
import { resetCityList } from "@/lib/search/cityList";
import { resetConsulateList } from "@/lib/search/consulateList";
import { resetSocTitleList } from "@/lib/search/socTitleList";

import { SearchPalette } from "../SearchPalette";

/**
 * The palette's order is its own (D14, Nov 25 2026): what's named as typed comes first, the site's own pages before a
 * list of names when both match alike, and cmdk is handed the rows in that order. Every list answers here, with rows
 * that compete for the top: an article about I-140 times, a city and an employer named Tampa, a page that mentions
 * receipts.
 */

const ARTICLES = [
  { title: "I-140 processing times and the premium processing clock", href: "/blog/i140-times", kind: "blog" },
  { title: "How to read a USCIS receipt number", href: "/guides/receipt-number", kind: "guides" },
];
const CONSULATES = [{ label: "Mumbai: immigrant visas", href: "/consular-posts/mumbai", keywords: "Mumbai consulate embassy" }];
const TITLES = [
  { title: "Software Engineer", code: "15-1252", href: "/soc-codes/software-engineer" },
  { title: "Registered Nurse", code: "29-1141", href: "/soc-codes/registered-nurse" },
];
const CITIES = [
  { label: "New York, NY", href: "/perm-cities/new-york-ny", keywords: "New York" },
  { label: "Tampa, FL", href: "/perm-cities/tampa-fl", keywords: "Florida" },
];

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

/** Every list and lookup answers; `employers` are what the employer lookup finds for "tampa". */
function answering({ entitiesFail = false } = {}) {
  return vi.fn((input: string) => {
    const url = String(input);
    if (url === "/articles.json") return json(ARTICLES);
    if (url === "/consulates.json") return json(CONSULATES);
    if (url === "/soc-titles.json") return json(TITLES);
    if (url === "/cities.json") return json(CITIES);
    if (url.startsWith("/api/perm-entities/")) {
      if (entitiesFail) return json({ error: "down" }, 503);
      const tampa = url.startsWith("/api/perm-entities/employer") && /q=tampa(&|$)/i.test(url);
      return json({ kind: "employer", count: 1, computedAt: null, rows: tampa ? [["tampa-general-hospital", "Tampa General Hospital", null, 812]] : [] });
    }
    if (url.startsWith("/api/suggest")) return json({ suggestions: [] });
    return new Promise<Response>(() => {});
  });
}

const noop = () => {};
const options = () => screen.getAllByRole("option");

async function typeAndSettle(text: string) {
  const user = userEvent.setup();
  render(<SearchPalette open onOpenChange={noop} />);
  // Every list in first, so the order checked is the order with everything competing.
  await screen.findByRole("option", { name: /premium processing clock/ });
  await user.type(screen.getByRole("combobox"), text);
  await waitFor(() => expect(screen.queryByText(/Searching employers, firms and occupations/)).toBeNull());
  return user;
}

beforeEach(() => {
  capture.mockClear();
  vi.stubGlobal("fetch", answering());
});
afterEach(() => {
  resetArticleList();
  resetConsulateList();
  resetSocTitleList();
  resetCityList();
  vi.unstubAllGlobals();
});

describe("the palette ranks every group itself", () => {
  it("puts the I-140 processing-times page first for “i-140 times”", async () => {
    await typeAndSettle("i-140 times");
    expect(options()[0]).toHaveTextContent(/^I-140 processing time$/);
    // The article that names the same words is still listed, below the page.
    expect(screen.getByRole("option", { name: /premium processing clock/ })).toBeTruthy();
  });

  it("puts the field office first for “tampa”, above the city and the employer", async () => {
    await typeAndSettle("tampa");
    await screen.findByRole("option", { name: /Tampa General Hospital/ });
    expect(options()[0]).toHaveTextContent(/^Tampa field office: I-485 numbers$/);
    expect(screen.getByRole("option", { name: "Tampa, FL" })).toBeTruthy();
    // The row the keys are on is the first row, after the late answers too: Enter opens the best match.
    await waitFor(() => expect(options()[0]).toHaveAttribute("aria-selected", "true"));
  });

  it("puts the receipt blocks page first for “receipt block”", async () => {
    await typeAndSettle("receipt block");
    expect(options()[0]).toHaveTextContent(/^USCIS receipt blocks$/);
  });

  it("finds a job title by its title or its code, named with the code", async () => {
    await typeAndSettle("registered nurse");
    expect(screen.getByRole("option", { name: "Registered Nurse (29-1141)" })).toBeTruthy();
  });

  it("finds a city by its state spelled out", async () => {
    await typeAndSettle("tampa florida");
    expect(screen.getByRole("option", { name: "Tampa, FL" })).toBeTruthy();
  });
});

describe("a search that finds nothing", () => {
  it("is recorded once, with its words only", async () => {
    await typeAndSettle("zzqxv");
    await waitFor(() => expect(capture).toHaveBeenCalledWith("search_miss", { query: "zzqxv" }));
    expect(capture.mock.calls.filter(([name]) => name === "search_miss")).toHaveLength(1);
  });

  it("isn't recorded when something matched", async () => {
    await typeAndSettle("tampa");
    await screen.findByRole("option", { name: /Tampa General Hospital/ });
    await new Promise((r) => setTimeout(r, 400));
    expect(capture.mock.calls.filter(([name]) => name === "search_miss")).toEqual([]);
  });

  it("isn't recorded when the name lookup failed, since nothing was really asked", async () => {
    vi.stubGlobal("fetch", answering({ entitiesFail: true }));
    await typeAndSettle("zzqxv");
    await screen.findByText(/corpus lookup didn/);
    await new Promise((r) => setTimeout(r, 400));
    expect(capture.mock.calls.filter(([name]) => name === "search_miss")).toEqual([]);
  });
});
