import type { FunctionReturnType } from "convex/server";

import type { api } from "@convex/_generated/api";
import { PageSection } from "@/components/data/PageSection";
import { NoteBanner } from "@/components/ui/note";
import { ScrollBox } from "@/components/ui/scroll-box";
import { CATEGORIES, COUNTRIES, DATE_FIELDS, OFFICE_STOPS, shareProgress, type MetricResult } from "@/lib/communityTimeline";
import { formatInt } from "@/lib/format";
import { isCenter, type UscisOffice } from "@/lib/uscisOffices";

import { ShareTimeline } from "./ShareTimeline";
import { AccountCodes, StageMedians, contactsText, h4Text, updatesText } from "./TimelineBoard";
import { KeepWhole } from "@/components/ui/keep-whole";

/**
 * "Timelines people shared from this office": what happened to I-485s at one USCIS office, as the people waiting
 * report it (convex/communityTimelines.ts, `office`), with the form to add one.
 *
 * SELF-REPORTED, AND SAID SO. USCIS publishes a pile and a quarter's decisions per office, never a wait. These
 * rows fill that gap from visitors, so the section says whose they are and keeps them apart from USCIS's counts
 * above it.
 *
 * THE FLOORS ARE THE QUERY'S. It sends rows only once three people at the office have shared theirs, a median
 * only over five, and approved timelines only, so this component can't print a row or a figure by mistake. A
 * read that failed is named as a failed read (`view` is null), never drawn as "nobody has shared".
 */

export type OfficeTimelineView = FunctionReturnType<typeof api.communityTimelines.office>;

const label = <T extends { id: string; label: string }>(list: readonly T[], id: string | null) =>
  id ? (list.find((x) => x.id === id)?.label ?? id) : "";

const monthName = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" });

const STOP_NAME = Object.fromEntries(DATE_FIELDS.map((f) => [f.id, f.short as string])) as Record<string, string>;

/** "40 days", or the month when the I-485 date wasn't given, or nothing. */
function stopText(s: { day: number | null; month: string | null }): string {
  if (s.day !== null) return `${formatInt(s.day)} ${s.day === 1 ? "day" : "days"}`;
  return s.month ? `in ${monthName(s.month)}` : "";
}

const place = (o: UscisOffice) => (isCenter(o) ? `the ${o.name}` : `the ${o.name} office`);

export function OfficeTimelines({ office, view }: { office: UscisOffice; view: OfficeTimelineView | null }) {
  const sharePath = `/i485-by-field-office/${office.slug}#timelines`;
  return (
    <PageSection
      id="timelines"
      title={`Timelines people shared from ${place(office)}`}
      className="scroll-mt-24"
      lede="USCIS doesn't publish how long one office takes, so this part comes from people whose I-485 was here. Their dates are self-reported, and each timeline is checked before it shows."
    >
      {view === null ? (
        <NoteBanner alert className="max-w-2xl">
          <p>The shared timelines can&apos;t be read right now. Try again in a few minutes.</p>
        </NoteBanner>
      ) : view.total === 0 ? (
        <p className="max-w-2xl text-base leading-relaxed text-soft">
          Nobody has shared a timeline from {place(office)} yet. Yours would be the first.
        </p>
      ) : (
        <p className="max-w-2xl text-base leading-relaxed text-soft">
          <b className="font-semibold text-foreground">
            {formatInt(view.total)} {view.total === 1 ? "timeline" : "timelines"}
          </b>{" "}
          so far{view.capped ? ", counting the newest" : ""}<KeepWhole>{". Each step is counted in days from the day the I-485 was filed."}</KeepWhole>
        </p>
      )}

      {/* The way in comes before the figures: one folded line, so it costs a phone almost nothing. */}
      <ShareTimeline
        office={office.code}
        sharePath={sharePath}
        shareLabel={`${office.name}'s timelines`}
        progress={view ? shareProgress(view.shared, view.opensAt, "this office's list") : undefined}
        className="mt-4 max-w-3xl"
      />

      {view && view.total > 0 ? (
        <>
          <div className="mt-6">
            <StageMedians metrics={view.metrics as readonly MetricResult[]} />
          </div>{" "}
          {/* Optional: a backend older than Nov 17 2026 sends no codes. */}
          <AccountCodes codes={view.codes ?? []} where={`timelines from ${place(office)}`} className="mt-6" />{" "}
          {view.open ? (
            <ScrollBox label={`Timelines shared from ${place(office)}`} className="mt-6 border-t-2 border-[var(--object-border)]">
              <table className="w-full min-w-[880px] border-collapse text-left text-base">
                <caption className="sr-only">
                  Timelines people shared from {place(office)}<KeepWhole>{": the month the I-485 was filed, then the days to each step"}</KeepWhole>
                </caption>
                <thead className="bg-sage">
                  <tr>
                    <th scope="col" className="px-3 py-3 text-sm font-bold"><KeepWhole>{"I-485 filed"}</KeepWhole>{" "}</th>
                    <th scope="col" className="px-3 py-3 text-sm font-bold">Category{" "}</th>
                    <th scope="col" className="px-3 py-3 text-sm font-bold">Country{" "}</th>
                    {OFFICE_STOPS.map((id) => (
                      <th key={id} scope="col" className="px-3 py-3 text-sm font-bold">
                        {`${STOP_NAME[id] ?? id} `}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-3 text-sm font-bold">Account updates{" "}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r, i) => (
                    <tr key={i} className="border-t-2 border-border/40 align-top">
                      <th scope="row" className="px-3 py-3 text-left font-normal tabular-nums">
                        {r.filedMonth ? `${monthName(r.filedMonth)} ` : "Not given "}
                        {r.rfe ? (
                          <span className="block text-sm text-muted-foreground">
                            <KeepWhole>{`RFE on the I-485${r.rfe.outcome === "approved" ? ", approved after it" : r.rfe.outcome === "denied" ? ", denied" : ""} `}</KeepWhole>
                          </span>
                        ) : null}
                      </th>
                      <td className="px-3 py-3">
                        {`${label(CATEGORIES, r.category)} `}
                        {r.applicant === "dependent" ? <span className="block text-sm text-muted-foreground">a dependent&apos;s case</span> : null}{" "}
                        {r.interview === "waived" ? <span className="block text-sm text-muted-foreground">interview waived</span> : null}{" "}
                        {r.contacts ? <span className="block text-sm text-muted-foreground">{`${contactsText(r.contacts)} `}</span> : null}{" "}
                        {/* Optional: a backend older than Nov 18 2026 sends no H-4. */}
                        {r.h4 ? <span className="block text-sm text-muted-foreground">{`${h4Text(r.h4)} `}</span> : null}
                      </td>
                      <td className="px-3 py-3">{`${label(COUNTRIES, r.country)} `}</td>
                      {r.stops.map((s) => (
                        <td key={s.id} className="px-3 py-3 tabular-nums">
                          {`${stopText(s)} `}
                        </td>
                      ))}
                      <td className="px-3 py-3">{`${updatesText(r.updates)} `}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollBox>
          ) : (
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-soft">
              The list of rows opens at {view.opensAt} shared timelines, so no one row stands alone. {formatInt(view.shared)} so far.
            </p>
          )}
        </>
      ) : null}
    </PageSection>
  );
}
