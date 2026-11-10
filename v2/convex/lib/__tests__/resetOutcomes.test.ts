import { describe, expect, it, vi } from "vitest";

import { RESET_QUIET_FLOOR, countResetOutcomes, resetVerdict, type ResetCounts } from "../resetOutcomes";

const week = (sent: number, completed: number, failed = 0): ResetCounts => ({ days: 7, sent, completed, failed });

describe("the morning report's password-reset line", () => {
  it("says what happened in an ordinary week, with no warning", () => {
    expect(resetVerdict(week(8, 5, 2))).toEqual({
      warn: false,
      line: "Password resets, 7 days: 8 codes sent, 5 completed, 2 wrong or expired codes",
    });
    expect(resetVerdict(week(1, 1))).toEqual({ warn: false, line: "Password resets, 7 days: 1 code sent, 1 completed" });
    expect(resetVerdict(week(0, 0)).warn).toBe(false);
  });

  it("doesn't warn over a few codes nobody used: people ask and never finish", () => {
    expect(resetVerdict(week(RESET_QUIET_FLOOR - 1, 0)).warn).toBe(false);
    expect(resetVerdict(week(2, 0, 5)).warn).toBe(false);
  });

  it("warns when codes went out all week and no reset completed", () => {
    const v = resetVerdict(week(RESET_QUIET_FLOOR, 0));
    expect(v.warn).toBe(true);
    expect(v.line).toBe("Password resets, 7 days: 6 codes sent and none completed. Try one from the sign-in page.");
  });

  it("warns sooner when codes were typed and every one was refused", () => {
    const v = resetVerdict(week(3, 0, 3));
    expect(v.warn).toBe(true);
    expect(v.line).toBe(
      "Password resets, 7 days: 3 codes sent and none completed, 3 wrong or expired codes. Try one from the sign-in page.",
    );
  });

  it("one completed reset is proof it works, whatever else happened", () => {
    expect(resetVerdict(week(40, 1, 30)).warn).toBe(false);
  });
});

describe("countResetOutcomes", () => {
  const ctx = { id: "ctx" };

  it("passes every other flow straight through, uncounted", async () => {
    const note = vi.fn(async () => {});
    const authorize = countResetOutcomes(async (p: Record<string, unknown>) => `ran ${String(p.flow)}`, note);
    for (const flow of ["signIn", "signUp", "reset", "email-verification"]) {
      expect(await authorize({ flow }, ctx)).toBe(`ran ${flow}`);
    }
    expect(note).not.toHaveBeenCalled();
  });

  it("counts a completed reset and returns the library's own answer", async () => {
    const note = vi.fn(async () => {});
    const answer = { userId: "u1", sessionId: "s1" };
    const authorize = countResetOutcomes(async () => answer, note);
    expect(await authorize({ flow: "reset-verification", code: "x", newPassword: "y" }, ctx)).toBe(answer);
    expect(note.mock.calls).toEqual([[ctx, "resetCompleted"]]);
  });

  it("counts a refused code and throws the library's own error", async () => {
    const note = vi.fn(async () => {});
    const refused = new Error("Invalid code");
    const authorize = countResetOutcomes(async () => {
      throw refused;
    }, note);
    await expect(authorize({ flow: "reset-verification", code: "bad" }, ctx)).rejects.toBe(refused);
    expect(note.mock.calls).toEqual([[ctx, "resetFailed"]]);
  });

  it("a count that fails never changes how the reset ends", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const note = vi.fn(async () => {
      throw new Error("the counter is down");
    });
    const answer = { userId: "u1" };
    expect(await countResetOutcomes(async () => answer, note)({ flow: "reset-verification" }, ctx)).toBe(answer);
    const refused = new Error("Invalid code");
    await expect(
      countResetOutcomes(async () => {
        throw refused;
      }, note)({ flow: "reset-verification" }, ctx),
    ).rejects.toBe(refused);
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});
