import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("@/lib/analytics", () => ({ analytics: { capture: (...a: unknown[]) => capture(...a) } }));

import { CertifiedNextWatch } from "../CertifiedNextWatch";

/**
 * A certified case's next watch: the bulletin alert, then the USCIS receipt alert (Nov 25 2026: the beta replaced the
 * question that counted who wanted it, as the Batch 6 plan placed it here). Neither names a price, says paid or free.
 */

const SENT = { ok: true, message: "Check your inbox to confirm." };
let fetched: ReturnType<typeof vi.fn>;

beforeEach(() => {
  capture.mockClear();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example-123.convex.cloud");
  fetched = vi.fn(async () => new Response(JSON.stringify(SENT), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetched);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CertifiedNextWatch", () => {
  it("keeps the bulletin alert first, under its own heading", () => {
    render(<CertifiedNextWatch anchorId="watch" filingDate="2025-03-04" />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    expect(headings[0]).toMatch(/Next, the visa bulletin/);
    expect(screen.getByRole("button", { name: "Email me when it moves" })).toBeDefined();
  });

  it("offers the USCIS receipt alert itself, with no 'working on it' and no price", () => {
    const { container } = render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    const words = container.textContent ?? "";
    expect(screen.getByRole("heading", { name: /USCIS/ })).toBeDefined();
    expect(screen.getAllByLabelText(/receipt/i).length).toBeGreaterThan(0);
    expect(words).not.toMatch(/working on it|when it's ready|tracking opens/i);
    expect(words).not.toMatch(/\$|\bfree\b|\bpaid\b|\bprice|\bpay\b|\bcost|subscription|\bplan\b|a month/i);
  });

  it("sends a plain bulletin sign-up from the first form, its source marked", async () => {
    render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    const email = screen.getAllByLabelText(/^email$/i, { selector: "input" })[0]!;
    fireEvent.change(email, { target: { value: "person@example.com" } });
    fireEvent.submit(email.closest("form")!);
    await waitFor(() => expect(fetched).toHaveBeenCalled());
    const sent = JSON.parse(String((fetched.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(sent.source).toBe("case-certified");
    expect(sent.news).toBeUndefined();
  });
});
