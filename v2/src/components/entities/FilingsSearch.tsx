import { Fragment } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/ssr";

import { buttonVariants } from "@/components/ui/button";
import { CASE_SEARCH_PATH, caseSearchHref } from "@/lib/caseSearchPlan";
import { formatInt } from "@/lib/format";
import { stateName } from "@/lib/usStateNames";
import type { FacetRow } from "@/lib/db/entityDetail";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";
import { RecentSearchesField } from "@/components/search/RecentSearches";

/**
 * Search one employer's, one job's or one law firm's filings, case by case, from its own page.
 *
 * A plain GET form into /case-search, so it works before any script runs and the address it lands on
 * can be shared. The page's subject rides along as a hidden field (`q` for an employer's name, `firm`
 * for a firm's slug, `occupation` for a job's slug) and the reader narrows by what the page doesn't
 * fix: a job title or one of the subject's own jobs, an employer, a state. Every program is searched
 * (PERM, wage requests, H-1B LCAs, H-2A, H-2B and CW-1), which is what /case-search does.
 *
 * The chips above the form are the subject's own busiest jobs or employers, each one tap from its
 * filings: "Software Developers, 3,420" on Microsoft's page opens Microsoft's Software Developers filings.
 * A chip wraps its words inside the card (half of all job titles are longer than a phone's chip), and a
 * program's name never breaks at its hyphen.
 */

type Fixed = { q?: string; firm?: string; occupation?: string };

export interface FilingsSearchProps {
  /**
   * What is searched, after "Search": "the filings of Microsoft Corporation", "the filings for Software
   * Developers". Never a possessive built on DOL's printed name, which reads "MERIT LOGISTICS's".
   */
  what: string;
  /** What the page itself is, sent along unchanged. */
  fixed: Fixed;
  /** The free-text box: a job title on an employer's or firm's page, an employer on a job's. */
  ask: "title" | "q";
  /** The subject's own jobs, for the picker and the chips. Left out on a job's own page. */
  jobs?: FacetRow[];
  /** The subject's own employers (a job's or a firm's), as chips. */
  employers?: FacetRow[];
  /** The states the subject's filings name. */
  states?: FacetRow[];
  className?: string;
}

const FIELD =
  "min-h-11 w-full min-w-0 border-2 border-input bg-card px-3 text-base font-medium focus-visible:ring-2 focus-visible:ring-primary";
const LABEL = "flex min-w-0 flex-col gap-1.5 text-sm font-bold";
const CHIPS = 6;

const ASK_LABEL = { title: "Job title", q: "Employer" } as const;
const ASK_HINT = { title: "e.g. Software engineer", q: "e.g. Amazon" } as const;

export function FilingsSearch({ what, fixed, ask, jobs = [], employers = [], states = [], className }: FilingsSearchProps) {
  const pickJob = !fixed.occupation && jobs.some((j) => j.key);
  const chips = (pickJob ? jobs : employers)
    .filter((r) => r.key)
    .slice(0, CHIPS)
    .map((r) => ({
      label: r.label,
      n: r.n,
      href: pickJob
        ? caseSearchHref({ ...fixed, occupation: r.key ?? "" })
        : caseSearchHref({ ...fixed, q: r.label }),
    }));
  // Every state the filings name, by name, A to Z: the list can run to every state and territory.
  const stateRows = states
    .filter((s): s is FacetRow & { key: string } => !!s.key && /^[A-Z]{2}$/.test(s.key))
    .map((s) => ({ key: s.key, name: stateName(s.key) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const columns = 1 + Number(pickJob) + Number(stateRows.length > 0);
  const title = `Search ${what}`;

  return (
    <section aria-labelledby="filings-search" className={className}>
      <div className="flex items-center gap-2">
        <MagnifyingGlassIcon className="size-5 shrink-0 text-primary-text" aria-hidden="true" />
        <h3 id="filings-search" className="font-heading text-xl font-bold">
          {title}
        </h3>
      </div>{" "}
      <p className="mt-1 text-base text-soft">
        <KeepWhole>Case by case, in every program: PERM, wage requests, H-1B, H-2A, H-2B and CW-1.</KeepWhole>
      </p>{" "}
      {chips.length ? (
        <div className="mt-4">
          <p className="text-sm font-bold">{pickJob ? "Their most-filed jobs" : "Who files it most"}</p>{" "}
          {/* The "Did you mean" chip's shape: the item may shrink to the list, and the words wrap inside the chip. */}
          <ul className="mt-2 flex flex-wrap gap-2">
            {chips.map((c) => (
              <Fragment key={c.href}>
                {" "}
                <li className="min-w-0 max-w-full">
                  <Link
                    href={c.href}
                    className="inline-flex min-h-11 max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 border-2 border-border bg-tint px-3 py-2 text-left text-sm font-semibold [overflow-wrap:anywhere] hover:border-foreground focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="min-w-0">{keepWhole(c.label)}</span>{" "}
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatInt(c.n)}</span>
                  </Link>
                </li>
              </Fragment>
            ))}
          </ul>
        </div>
      ) : null}{" "}
      <form
        action={CASE_SEARCH_PATH}
        method="get"
        role="search"
        aria-label={title}
        className={`mt-5 grid grid-cols-1 items-end gap-3 [&>*]:min-w-0 ${
          columns === 3 ? "md:grid-cols-[2fr_2fr_1fr_auto]" : columns === 2 ? "md:grid-cols-[2fr_1fr_auto]" : "md:grid-cols-[1fr_auto]"
        }`}
      >
        {Object.entries(fixed).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {/* Around the label, so the list under the box is never read as part of the box's name. */}
        <RecentSearchesField record="submit">
          <label className={LABEL}>
            {ASK_LABEL[ask]}{" "}
            <input type="search" name={ask} placeholder={ASK_HINT[ask]} maxLength={80} autoComplete="off" className={FIELD} />
          </label>
        </RecentSearchesField>{" "}
        {pickJob ? (
          <label className={LABEL}>
            Job (SOC){" "}
            <select name="occupation" defaultValue="" className={FIELD}>
              <option value="">Any job</option>
              {jobs
                .filter((j) => j.key)
                .map((j) => (
                  <option key={j.key} value={j.key ?? ""}>
                    {j.code ? `${j.label} (${j.code})` : j.label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}{" "}
        {stateRows.length ? (
          <label className={LABEL}>
            State{" "}
            <select name="state" defaultValue="" className={FIELD}>
              <option value="">Any state</option>
              {stateRows.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}{" "}
        <button type="submit" className={buttonVariants({ size: "lg", className: "min-h-11 w-full md:w-auto" })}>
          <MagnifyingGlassIcon className="size-4" aria-hidden="true" />
          Search
        </button>
      </form>
    </section>
  );
}
