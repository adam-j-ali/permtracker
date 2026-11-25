/**
 * Disconnecting Google Calendar always clears the stored tokens (Nov 25 2026). A token that wouldn't decrypt (an
 * encryption key changed, a damaged row) threw before the clear, so the person could never disconnect.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthenticatedContext, createTestContext } from "../../test-utils/convex";
import { api } from "../_generated/api";
import { buildDefaultProfile } from "../lib/userDefaults";

afterEach(() => vi.unstubAllGlobals());

describe("disconnectWithRevocation", () => {
  it("clears the tokens when the stored token won't decrypt, and skips the revoke", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const t = createTestContext();
    const user = await createAuthenticatedContext(t);
    await t.run((ctx) =>
      ctx.db.insert("userProfiles", {
        ...buildDefaultProfile(user.userId),
        googleAccessToken: "not-a-token-this-key-can-read",
        googleRefreshToken: "also-unreadable",
        googleCalendarConnected: true,
      }),
    );
    const got = await user.action(api.googleAuth.disconnectWithRevocation, {});
    expect(got).toMatchObject({ success: true, revoked: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    const profile = await t.run((ctx) =>
      ctx.db.query("userProfiles").withIndex("by_user_id", (q) => q.eq("userId", user.userId)).unique(),
    );
    expect(profile?.googleAccessToken).toBeUndefined();
    expect(profile?.googleRefreshToken).toBeUndefined();
    expect(profile?.googleCalendarConnected).toBe(false);
  });
});
