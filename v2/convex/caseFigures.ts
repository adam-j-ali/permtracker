import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * The dates on the saved cases of accounts that chose to count them in the public figures (Settings, "Count my cases
 * in the public figures": userProfiles.countCaseDates, off unless switched on), for the hourly merge of reported cases
 * (scripts/build_reported_cases.py --from-convex, through GET /reported-export behind the server's secret).
 *
 * Dates, the I-140's category and premium processing only: never a name, an employer, a job, a case number, a note
 * or the account. The merge counts them in the figures and lists none of them, and each case counts once however
 * many people's cases an account holds.
 */

/** Accounts read per build, and cases. Far above today's use; a build past them counts the newest it reached. */
const PROFILES_CAP = 2_000;
const CASES_CAP = 4_000;

export const caseFigureRowV = v.object({
  id: v.string(),
  updatedAt: v.number(),
  pwdFilingDate: v.optional(v.string()),
  pwdDeterminationDate: v.optional(v.string()),
  eta9089FilingDate: v.optional(v.string()),
  eta9089AuditDate: v.optional(v.string()),
  eta9089CertificationDate: v.optional(v.string()),
  eta9089DenialDate: v.optional(v.string()),
  i140FilingDate: v.optional(v.string()),
  i140ApprovalDate: v.optional(v.string()),
  i140DenialDate: v.optional(v.string()),
  i140Category: v.optional(v.string()),
  i140PremiumProcessing: v.optional(v.boolean()),
});

export const exportForMerge = internalQuery({
  args: {},
  returns: v.array(caseFigureRowV),
  handler: async (ctx) => {
    const profiles = await ctx.db
      .query("userProfiles")
      .withIndex("by_count_case_dates", (q) => q.eq("countCaseDates", true))
      .take(PROFILES_CAP);
    const out: (typeof caseFigureRowV.type)[] = [];
    for (const p of profiles) {
      if (p.deletedAt !== undefined) continue;
      const cases = await ctx.db
        .query("cases")
        .withIndex("by_user_and_deleted", (q) => q.eq("userId", p.userId).eq("deletedAt", undefined))
        .take(CASES_CAP - out.length);
      for (const c of cases) {
        // The onboarding sample isn't anyone's case, and a duplicate would count one case twice.
        if (c.isSample || c.duplicateOf !== undefined) continue;
        out.push({
          id: c._id,
          updatedAt: c.updatedAt,
          pwdFilingDate: c.pwdFilingDate,
          pwdDeterminationDate: c.pwdDeterminationDate,
          eta9089FilingDate: c.eta9089FilingDate,
          eta9089AuditDate: c.eta9089AuditDate,
          eta9089CertificationDate: c.eta9089CertificationDate,
          eta9089DenialDate: c.eta9089DenialDate,
          i140FilingDate: c.i140FilingDate,
          i140ApprovalDate: c.i140ApprovalDate,
          i140DenialDate: c.i140DenialDate,
          i140Category: c.i140Category,
          i140PremiumProcessing: c.i140PremiumProcessing,
        });
      }
      if (out.length >= CASES_CAP) break;
    }
    return out;
  },
});
