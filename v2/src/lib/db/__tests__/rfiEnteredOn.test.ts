import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The day a case's RFI began, as the case page and the estimate use it. A case first seen at its RFI during the
 * record's catch-up has no known start: the day on that row is the day we looked.
 */
const one = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ one: (...a: unknown[]) => one(...a) }));

const { rfiEnteredOn } = await import("../rfiClock");

// An instant at a given Eastern hour, in daylight time (UTC-4).
const at = (day: string, hourEt: number) => Date.parse(`${day}T${String(hourEt + 4).padStart(2, "0")}:00:00Z`);

beforeEach(() => {
  one.mockReset();
});

describe("rfiEnteredOn", () => {
  it("gives the Eastern day the sweep saw the case enter its RFI", async () => {
    one.mockResolvedValue({ at: String(at("2026-09-30", 10)) });
    expect(await rfiEnteredOn(" g-100-26045-123456 ")).toBe("2026-09-30");
    expect(one.mock.calls[0]?.[1]?.[0]).toBe("G-100-26045-123456");
  });

  it("gives no day for an RFI first seen during the catch-up, on either of its days", async () => {
    one.mockResolvedValue({ at: at("2026-08-28", 16) });
    expect(await rfiEnteredOn("G-100-25200-000001")).toBeNull();
    one.mockResolvedValue({ at: at("2026-08-29", 19) });
    expect(await rfiEnteredOn("G-100-25200-000002")).toBeNull();
  });

  it("counts the first day after the catch-up", async () => {
    one.mockResolvedValue({ at: at("2026-08-30", 9) });
    expect(await rfiEnteredOn("G-100-25200-000003")).toBe("2026-08-30");
  });

  it("gives no day when the record holds no entry, or one it can't read", async () => {
    one.mockResolvedValue({ at: null });
    expect(await rfiEnteredOn("G-100-25200-000004")).toBeNull();
    one.mockResolvedValue(null);
    expect(await rfiEnteredOn("G-100-25200-000005")).toBeNull();
    one.mockResolvedValue({ at: "not a number" });
    expect(await rfiEnteredOn("G-100-25200-000006")).toBeNull();
  });
});
