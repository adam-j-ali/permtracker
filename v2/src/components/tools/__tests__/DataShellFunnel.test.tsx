// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Every data page ends with a box for its step (owner, Oct 15 2026: the two things people come for are when their
 * case will be decided and an email when it moves; Nov 26 2026: the box asks for what the page's reader has, a PERM
 * or DOL case, a USCIS receipt, the bulletin's alert, the consulates). The pages that already lead with their own
 * box skip it. Which box each page gets: closingBox.test.ts.
 */
const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { DataShell } = await import("../DataShell");
const { SECTIONS, CALCULATOR_PAGES } = await import("@/lib/siteMap");

const OWN_BOX = ["/perm-case-status", "/perm-case-alerts", "/case-search", "/uscis-case-status", "/visa-bulletin", "/tools/priority-date-calculator"];
const BOXES = ["Check your case", "Check a USCIS receipt", "Visa bulletin alert", "Consulates and the National Visa Center"];
const endsWithCaseBlock = (path: string) => {
  nav.path = path;
  const { unmount } = render(<DataShell><p>page</p></DataShell>);
  const has = BOXES.some((name) => screen.queryByRole("region", { name }) !== null
    || document.querySelector(`section[aria-label="${name}"]`) !== null);
  unmount();
  return has;
};

describe("the end of every data page", () => {
  const pages = [...SECTIONS, ...CALCULATOR_PAGES].map((p) => p.href).filter((h) => !OWN_BOX.some((o) => h.startsWith(o)));

  it("covers the whole map", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it.each(pages)("%s ends with its step's box", (href) => {
    expect(endsWithCaseBlock(href)).toBe(true);
  });

  it.each([...OWN_BOX, "/perm-employers/adobe-inc", "/perm-queue/2025-11"])("%s leads with its own box instead", (href) => {
    expect(endsWithCaseBlock(href)).toBe(false);
  });
});
