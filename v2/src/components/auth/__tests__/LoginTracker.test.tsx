// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * LoginTracker turns a browser back on only when the account's exclusion turned it off and no longer applies. A
 * person's own "off" on this browser (the footer switch, or a Settings switch-off whose save failed) is theirs: no
 * sign-in or page load ever undoes it.
 */
const posthog = vi.hoisted(() => ({
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  has_opted_in_capturing: vi.fn(() => false),
  identify: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));
const server = vi.hoisted(() => ({ excluded: false as boolean | undefined }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useMutation: () => vi.fn().mockResolvedValue(null),
  useQuery: (ref: string) => (ref === "users:isPostHogExcluded" ? server.excluded : { _id: "u1", fullName: "A Person" }),
}));
vi.mock("@convex/_generated/api", () => ({
  api: { users: { recordMyLogin: "users:recordMyLogin", currentUserProfile: "users:currentUserProfile", isPostHogExcluded: "users:isPostHogExcluded" } },
}));

const { LoginTracker } = await import("../LoginTracker");
const { ANALYTICS_OFF_KEY, VISITOR_OFF_KEY, isAnalyticsOff } = await import("@/lib/analytics");

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  server.excluded = false;
});
afterEach(() => window.localStorage.clear());

describe("LoginTracker and a browser switched off", () => {
  it("never turns back on a browser the person switched off, though the account says on", async () => {
    // Arrange: a Settings switch-off whose save failed, so the server still says on
    window.localStorage.setItem(ANALYTICS_OFF_KEY, "1");
    window.localStorage.setItem(VISITOR_OFF_KEY, "1");
    // Act
    render(<LoginTracker />);
    // Assert
    await waitFor(() => expect(window.localStorage.getItem(ANALYTICS_OFF_KEY)).toBeNull());
    expect(isAnalyticsOff()).toBe(true);
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("turns back on a browser that only the account's exclusion had turned off", async () => {
    // Arrange: an account that was excluded and no longer is
    window.localStorage.setItem(ANALYTICS_OFF_KEY, "1");
    // Act
    render(<LoginTracker />);
    // Assert
    await waitFor(() => expect(isAnalyticsOff()).toBe(false));
  });

  it("keeps an excluded account's browser off", async () => {
    // Arrange
    server.excluded = true;
    // Act
    render(<LoginTracker />);
    // Assert
    await waitFor(() => expect(window.localStorage.getItem(ANALYTICS_OFF_KEY)).toBe("1"));
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
  });
});
