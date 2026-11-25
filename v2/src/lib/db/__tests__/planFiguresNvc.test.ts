/** The consular step's interview wait: measured from people's employment cases when they hold a median, else the stated assumption. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ rows: vi.fn(), one: vi.fn(), exec: vi.fn() }));

const { nvcSpans } = await import("../planFigures");
const { CONSULAR_INTERVIEW_DAYS_ASSUMED } = await import("@/lib/perm");

const reading = { reviewLagDays: 20, creationLagDays: 10 } as never;

describe("nvcSpans", () => {
  it("adds the measured employment interview wait when there is one", () => {
    expect(nvcSpans([reading], { low: 40, mid: 60, high: 90 })?.consular).toEqual({ low: 60, mid: 80, high: 110 });
  });
  it("keeps the stated assumption without one", () => {
    const a = CONSULAR_INTERVIEW_DAYS_ASSUMED;
    expect(nvcSpans([reading])?.consular).toEqual({ low: 20 + a.low, mid: 20 + a.mid, high: 20 + a.high });
  });
});
