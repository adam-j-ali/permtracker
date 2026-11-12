import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("@/lib/analytics", () => ({ analytics: { capture: (...a: unknown[]) => capture(...a) } }));

import { CertifiedNextWatch } from "../CertifiedNextWatch";

/**
 * A certified case's next watch: the bulletin alert, then one question about USCIS case tracking.
 *
 * The question exists to count who wants it before it's built out. It names no price and never says paid or
 * free: that was the owner's condition for asking at all.
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

const pressed = () => capture.mock.calls.filter((c) => c[0] === "uscis_interest");
const body = () => JSON.parse(String((fetched.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
async function signUp(email: string) {
  fireEvent.change(screen.getByLabelText(/^email$/i, { selector: "input" }), { target: { value: email } });
  fireEvent.submit(screen.getByLabelText(/^email$/i, { selector: "input" }).closest("form")!);
  await waitFor(() => expect(fetched).toHaveBeenCalled());
}

describe("CertifiedNextWatch", () => {
  it("keeps the bulletin alert first, under its own heading", () => {
    render(<CertifiedNextWatch anchorId="watch" filingDate="2025-03-04" />);
    expect(screen.getByRole("heading", { name: /Next, the visa bulletin/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "Email me when it moves" })).toBeDefined();
  });

  it("asks about USCIS tracking with no price, and never says paid or free", () => {
    const { container } = render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    expect(screen.getByRole("button", { name: "Tell me when it's ready" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Tell me when it's ready" }));
    const words = container.textContent ?? "";
    expect(words).not.toMatch(/\$|\bfree\b|\bpaid\b|\bprice|\bpay\b|\bcost|subscription|\bplan\b|a month/i);
  });

  it("counts a press once, says so, and ticks the box that gets the email", () => {
    render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    const box = screen.getByRole("checkbox", { name: /USCIS case tracking/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Tell me when it's ready" }));
    expect(pressed()).toEqual([["uscis_interest", { step: "pressed", source: "case-certified" }]]);
    expect(screen.getByRole("status").textContent).toMatch(/Noted/);
    expect(box.checked).toBe(true);
    // The button is gone once pressed, so one person is one count.
    expect(screen.queryByRole("button", { name: "Tell me when it's ready" })).toBeNull();
  });

  it("remembers the press in this browser, so coming back doesn't count again", () => {
    const first = render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Tell me when it's ready" }));
    first.unmount();
    capture.mockClear();
    render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    expect(screen.queryByRole("button", { name: "Tell me when it's ready" })).toBeNull();
    expect(pressed()).toEqual([]);
  });

  it("sends the sign-up with the news list on and the source marked, when the box is ticked", async () => {
    render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /USCIS case tracking/ }));
    await signUp("person@example.com");
    expect(body()).toMatchObject({ email: "person@example.com", news: true, source: "case-certified-uscis" });
    await waitFor(() => expect(pressed().some((c) => (c[1] as { step: string }).step === "signed")).toBe(true));
  });

  it("sends a plain bulletin sign-up when the box is left alone", async () => {
    render(<CertifiedNextWatch anchorId="watch" filingDate={null} />);
    await signUp("person@example.com");
    expect(body().source).toBe("case-certified");
    expect(body().news).toBeUndefined();
    expect(pressed()).toEqual([]);
  });
});
