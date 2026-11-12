import type { ReactNode } from "react";
import { CurrencyDollarIcon, HourglassMediumIcon, IdentificationCardIcon } from "@phosphor-icons/react/ssr";

import { aboutMonths } from "@/lib/board";
import type { Plan } from "@/lib/perm";
import { daysBetween } from "@convex/lib/time";

import { dayLabel, rangeLabel, usd } from "./format";

/**
 * The plan's answer in three figures: when the green card comes, how long that is from today,
 * and what it costs. Everything else on the page explains these.
 */
export function AnswerBand({ plan, today, noDateWhy }: { plan: Plan; today: string; noDateWhy: string }) {
  const gc = plan.greenCard;
  const known = plan.knownMilestones.has("greenCard");
  const wait = gc ? daysBetween(today, gc.mid) : null;
  const hasOwn = plan.costs.some((c) => c.source === "own");
  return (
    <section aria-label="Your plan at a glance" className="mt-8">
      <dl className="grid grid-cols-1 bg-foreground text-background sm:grid-cols-3 dark:bg-card dark:text-foreground">
        <Figure icon={<IdentificationCardIcon weight="bold" />} label="Green card" value={gc ? dayLabel(gc.mid, today, known) : "No date yet"} note={gc ? (known ? "Your date" : rangeLabel(gc, today)) : noDateWhy} lead />{" "}
        <Figure
          icon={<HourglassMediumIcon weight="bold" />}
          label="From today"
          value={wait === null ? "Not dated" : wait <= 0 ? "Done" : aboutMonths(wait).replace(/^about /, "")}
          note={wait === null ? "Every step before the bulletin is dated below" : wait <= 0 ? "Approved" : "Typical. The range is in your dates"}
        />{" "}
        <Figure icon={<CurrencyDollarIcon weight="bold" />} label="Cost" value={usd(plan.totals.all)} note={hasOwn ? "Government fees and your own costs" : "Government fees. Add your own costs below"} />
      </dl>
    </section>
  );
}

function Figure({ icon, label, value, note, lead }: { icon: ReactNode; label: string; value: string; note: string; lead?: boolean }) {
  return (
    <div className="border-t border-background/20 p-5 first:border-t-0 sm:border-t-0 sm:border-l sm:p-6 sm:first:border-l-0 dark:border-foreground/20">
      <dt className="flex items-center gap-1.5 text-sm opacity-80">
        <span aria-hidden="true" className="inline-flex shrink-0 [&_svg]:size-4">
          {icon}
        </span>
        {label}
      </dt>{" "}
      <dd className="mt-1">
        <span className={lead ? "block font-heading text-4xl font-bold tabular-nums text-primary-on-ink dark:text-primary-text" : "block font-heading text-4xl font-bold tabular-nums"}>
          {value}
        </span>{" "}
        <span className="mt-1 block text-sm opacity-80">{note}</span>
      </dd>
    </div>
  );
}
