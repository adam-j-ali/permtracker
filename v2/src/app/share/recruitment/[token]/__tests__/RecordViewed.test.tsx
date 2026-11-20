/**
 * The shared record's view note is sent from the browser after the page loads, once, with the link's key, and a
 * failed save never reaches the reader.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ made: [] as string[], mutation: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url: string) {
      calls.made.push(url);
    }
    mutation = calls.mutation;
  },
}));
vi.mock("@convex/_generated/api", () => ({ api: { recruitmentShares: { recordView: "recruitmentShares:recordView" } } }));

const { RecordViewed } = await import("../RecordViewed");
const TOKEN = "Zk3_x-9QwErTyUiOpAsDfGhJkLzXcVbNm1234567890";

describe("the shared record's view note", () => {
  afterEach(() => {
    calls.made.length = 0;
    calls.mutation.mockReset();
    vi.unstubAllEnvs();
  });

  it("asks Convex once, with the key, and renders nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    calls.mutation.mockResolvedValue(null);
    const { container } = render(<RecordViewed token={TOKEN} />);
    expect(container.innerHTML).toBe("");
    expect(calls.made).toEqual(["https://example.convex.cloud"]);
    expect(calls.mutation).toHaveBeenCalledTimes(1);
    expect(calls.mutation).toHaveBeenCalledWith("recruitmentShares:recordView", { token: TOKEN });
  });

  it("keeps a failed save to itself", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    calls.mutation.mockRejectedValue(new Error("offline"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    render(<RecordViewed token={TOKEN} />);
    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
