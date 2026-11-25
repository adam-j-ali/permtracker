// @vitest-environment jsdom
/**
 * The JSON-LD a page renders, held to a snapshot taken before its FAQPage and Dataset nodes moved to the shared
 * helpers (getFAQPageSchema, datasetSchemaFor; Nov 25 2026). The move changed how the nodes are written, never what
 * they say: each snapshot here was written by the inline literals and is matched by the helpers. A change to a
 * snapshot is a change to what search engines read, so it's made on purpose or not at all.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
vi.mock("@/lib/db/uscisQuarterly", () => ({ getEbAwaitingVisa: async () => null, getI140ClassCountry: async () => null }));

/** Every JSON-LD block a rendered page carries, parsed, in page order. */
function jsonLd(container: HTMLElement): unknown[] {
  return [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? "null"));
}

const snap = (name: string) => `./__snapshots__/jsonld/${name}.json`;

describe("a page's JSON-LD is the same after the move to the shared helpers", () => {
  it("a calculator's questions (/tools/pwd-validity)", async () => {
    const { default: Page } = await import("../(site)/(public)/tools/pwd-validity/page");
    const { container } = render(<Page />);
    await expect(JSON.stringify(jsonLd(container), null, 1)).toMatchFileSnapshot(snap("tools-pwd-validity"));
  });

  it("the alerts page's questions (/perm-case-alerts)", async () => {
    const { default: Page } = await import("../(site)/(public)/perm-case-alerts/page");
    const { container } = render(<Page />);
    await expect(JSON.stringify(jsonLd(container), null, 1)).toMatchFileSnapshot(snap("perm-case-alerts"));
  });

  it("an agency's own table and its questions (/i140-awaiting-visa)", async () => {
    const { default: Page } = await import("../(site)/(public)/i140-awaiting-visa/page");
    const { container } = render(await Page());
    await expect(JSON.stringify(jsonLd(container), null, 1)).toMatchFileSnapshot(snap("i140-awaiting-visa"));
  });
});
