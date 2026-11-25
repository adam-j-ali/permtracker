/**
 * The kinds of alert that leave through `deliverAlert` (convex/lib/alertDelivery.ts), said once.
 *
 * The same list had five copies: the outbox table's column, the outbox's and the admin panel's argument
 * validators, the delivery type and the opt-out helper's type. A kind added to some of them and not the others
 * typechecked and failed at runtime, so every one of them now reads this validator or its type.
 */
import { v, type Infer } from "convex/values";

export const alertKindValidator = v.union(
  v.literal("case"),
  v.literal("queue"),
  v.literal("bulletin"),
  v.literal("employer"),
  // A PERM that may follow a watched wage request (convex/pipelineMatches.ts).
  v.literal("match"),
  // A watched USCIS receipt's status change (convex/uscisAlerts.ts).
  v.literal("uscis"),
);

export type AlertKind = Infer<typeof alertKindValidator>;

/** Every kind, for a check that walks them all. */
export const ALERT_KINDS = alertKindValidator.members.map((m) => m.value) as readonly AlertKind[];
