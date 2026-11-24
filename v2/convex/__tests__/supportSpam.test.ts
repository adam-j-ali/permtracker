import { describe, expect, it } from "vitest";

import { createTestContext } from "../../test-utils/convex";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { SPAM_BY_HAND } from "../supportEmail";

/**
 * Support mail that's spam or marketing gets no reply: marked by hand, it's archived, so nothing lists it as waiting,
 * and it carries the reason beside any the spam check gave.
 */
async function stored(t: ReturnType<typeof createTestContext>, over: Record<string, unknown> = {}) {
  return t.run(async (ctx) =>
    ctx.db.insert("supportEmails", {
      fromEmail: "growth@example.org",
      toEmail: "support@permtracker.app",
      subject: "Partnership opportunity",
      bodyText: "We'd love to feature your project.",
      messageId: "<m1@example.org>",
      resendEmailId: "cf-1",
      status: "forwarded",
      createdAt: Date.now(),
      ...over,
    }),
  );
}

describe("supportEmail.markSpamOrMarketing", () => {
  it("archives the message and says why", async () => {
    // Arrange
    const t = createTestContext();
    const id = await stored(t, { spamReasons: ["a link shortener"] });
    // Act
    const got = await t.mutation(internal.supportEmail.markSpamOrMarketing, { supportEmailId: id });
    // Assert
    expect(got).toEqual({ was: "forwarded" });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.status).toBe("archived");
    expect(row?.spamReasons).toEqual(["a link shortener", SPAM_BY_HAND]);
  });

  it("changes nothing more when marked twice, and keeps a reply already sent", async () => {
    const t = createTestContext();
    const id = await stored(t, { status: "replied", replyBody: "Thanks", repliedAt: 1 });
    await t.mutation(internal.supportEmail.markSpamOrMarketing, { supportEmailId: id });
    const again = await t.mutation(internal.supportEmail.markSpamOrMarketing, { supportEmailId: id });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(again).toEqual({ was: "archived" });
    expect(row?.spamReasons).toEqual([SPAM_BY_HAND]);
    expect(row?.replyBody).toBe("Thanks");
  });

  it("answers null for a message that isn't there", async () => {
    const t = createTestContext();
    const id = await stored(t);
    await t.run((ctx) => ctx.db.delete(id as Id<"supportEmails">));
    expect(await t.mutation(internal.supportEmail.markSpamOrMarketing, { supportEmailId: id })).toBeNull();
  });

  it("isn't callable from a browser: an internal mutation only", async () => {
    const mod = await import("../supportEmail");
    expect((mod.markSpamOrMarketing as unknown as { isInternal?: boolean }).isInternal).toBe(true);
  });
});
