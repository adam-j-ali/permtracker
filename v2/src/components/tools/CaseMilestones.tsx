"use client";

import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { CaretRightIcon, CheckIcon, WarningIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/data/PageSection";
import { TimelineFormFields } from "@/components/community/TimelineFormFields";
import {
  caseKey,
  forgetKey,
  loadMine,
  newKey,
  ownKey,
  rememberKey,
  removeTimeline,
  saveTimeline,
  statusNote,
  type Mine,
} from "@/components/community/timelineClient";
import { PERM_CASE, isPermCategory, validateTimeline, type TimelineInput } from "@/lib/communityTimeline";
import { convexSiteUrl } from "@/lib/convexSite";
import { shortDate } from "@convex/lib/months";

/**
 * The case's timeline after PERM: what people report, and a form to add
 * yours. It also counts the reports made through the older one-milestone
 * form.
 *
 * WHAT IS CHECKED AND WHAT IS NOT is said above the form, not under it: the
 * PERM dates come from DOL's record by case number and are never typed here;
 * everything after PERM has no public per-case source and is self-reported.
 *
 * No account. The browser keeps a random key (components/community/timelineClient.ts),
 * and whoever holds it can change or remove the timeline. Without storage the
 * key lasts the visit, and the form says nothing different: it still works.
 * A timeline this browser saved elsewhere with no case number opens here too,
 * and saving it here ties it to this case.
 *
 * A saved timeline waits for a review before it counts anywhere, and the form
 * says so. The boxes themselves are shared with the form on a USCIS office's
 * page (components/community/TimelineFormFields.tsx).
 *
 * The `#timeline` anchor is what the "certified" alert email links to, and it
 * opens the form.
 */

interface Summary {
  timelines: number;
  stops: { id: string; label: string; count: number }[];
  /** Fewer than three people have added dates; the server sent no counts. Absent from an older backend. */
  withheld?: boolean;
}
const fullDay = (iso: string) => shortDate(iso) ?? iso;

const EMPTY: TimelineInput = { route: "adjustment", public: false };

export function CaseMilestones({ caseNumber, className }: { caseNumber: string; className?: string }) {
  const uid = useId();
  const valid = PERM_CASE.test(caseNumber);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  // A returning visitor's saved dates are on their way: the heading says so instead of "Add your dates".
  const [mineLoading, setMineLoading] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [form, setForm] = useState<TimelineInput>(EMPTY);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "done" | "refused"; message: string }
  >({ kind: "idle" });

  const summaryUrl = valid ? convexSiteUrl(`/timeline/summary?case=${encodeURIComponent(caseNumber)}`) : null;

  const loadSummary = (fresh = false) => {
    if (!summaryUrl) return;
    fetch(summaryUrl, fresh ? { cache: "no-store" } : undefined)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Summary | null) => {
        if (s) setSummary(s);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!valid) return;
    loadSummary();
    if (window.location.hash === "#timeline") setOpen(true);
    const show = (k: string, m: Mine) => {
      setKey(k);
      setMine(m);
      setForm({ ...EMPTY, ...m.input });
      setOpen(true);
    };
    const forThisCase = caseKey(caseNumber);
    const own = forThisCase ? null : ownKey();
    if (!forThisCase && !own) return;
    setMineLoading(true);
    void (async () => {
      if (forThisCase) {
        setKey(forThisCase);
        const m = await loadMine(forThisCase, caseNumber);
        if (m) show(forThisCase, m);
      } else if (own) {
        // A timeline saved on an office's page with no case number, or with this one, opens here. One that
        // names another case, or a category with no PERM, stays where it is, and this case starts a new one.
        const m = await loadMine(own);
        const fits = m && (m.caseNumber == null || m.caseNumber === caseNumber) && (!m.input.category || isPermCategory(m.input.category));
        if (m && fits) show(own, m);
      }
      setMineLoading(false);
    })();
    // Runs once per case: the summary URL and key are derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseNumber, valid]);

  const check = useMemo(() => validateTimeline(form), [form]);

  if (!valid) return null;
  if (!convexSiteUrl("/timeline/save")) return null;

  const set = <K extends keyof TimelineInput>(k: K, v: TimelineInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (state.kind !== "sending") setState({ kind: "idle" });
  };

  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    if (!check.ok) {
      setState({ kind: "refused", message: check.message });
      return;
    }
    const k = key ?? newKey();
    setState({ kind: "sending" });
    const reply = await saveTimeline(k, caseNumber, form);
    if (reply.ok) {
      rememberKey(k, caseNumber);
      setKey(k);
      setMine((m) => ({
        input: form,
        caseNumber,
        status: reply.status,
        permFiledOn: m?.permFiledOn ?? null,
        permCertifiedOn: m?.permCertifiedOn ?? null,
      }));
      loadSummary(true);
    }
    setState({ kind: reply.ok ? "done" : "refused", message: reply.message });
  }

  async function remove() {
    if (!key || state.kind === "sending") return;
    setState({ kind: "sending" });
    const reply = await removeTimeline(key);
    if (reply.ok) {
      forgetKey(key);
      setKey(null);
      setMine(null);
      setForm(EMPTY);
      loadSummary(true);
    }
    setState({ kind: reply.ok ? "done" : "refused", message: reply.message });
  }

  const stops = summary?.stops ?? [];

  const shown = stops.filter((st) => st.count > 0);

  return (
    <PageSection
      id="timeline"
      title="After PERM"
      className={className}
      lede="USCIS doesn't publish the I-140 or the I-485 case by case, so this part comes from the people waiting. Their dates are self-reported. The PERM dates come from DOL's own record."
    >
      {summary ? (
        <p className="text-base leading-relaxed text-soft">
          {shown.length > 0 ? (
            <>
              Reported for this case:{" "}
              {shown.map((st, i) => (
                <Fragment key={st.id}>
                  {i > 0 ? ", " : ""}
                  <b className="font-semibold text-foreground">{st.label}</b> ({st.count})
                </Fragment>
              ))}
              .
            </>
          ) : summary.withheld ? (
            // One case is one person's filing, so a handful of reports would be their own progress.
            "Dates people add for this case show here once three have added them."
          ) : !mine ? (
            "Nobody has added dates for this case yet."
          ) : null}
        </p>
      ) : null}

      <details
        className="group mt-4 border-t-2 border-border"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <CaretRightIcon className="size-4 shrink-0 transition-transform group-open:rotate-90" weight="bold" aria-hidden="true" />{" "}
          {mine ? "Your timeline for this case" : mineLoading ? "Loading your timeline…" : "Add your dates"}
        </summary>

        {mine?.permCertifiedOn ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-soft">
            <CheckIcon size={18} weight="bold" className="mt-0.5 shrink-0 text-primary-text" aria-hidden="true" />
            <span>
              DOL&apos;s record for this case: filed{" "}
              {mine.permFiledOn ? <b translate="no">{fullDay(mine.permFiledOn)}</b> : "on a date DOL doesn't show"},
              certified <b translate="no">{fullDay(mine.permCertifiedOn)}</b>.
            </span>
          </p>
        ) : null}

        {mine && statusNote(mine.status) ? (
          <p role="status" className="mt-3 border-2 border-border bg-soft-wait p-3 text-base">
            {statusNote(mine.status)}
          </p>
        ) : null}

        <form onSubmit={save} className="mt-4 space-y-6" noValidate>
          <TimelineFormFields uid={uid} variant="case" form={form} set={set} />{" "}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" loading={state.kind === "sending"}>
              {mine ? "Save changes" : "Save my timeline"}
            </Button>{" "}
            {mine ? (
              <Button type="button" variant="ghost" onClick={remove} disabled={state.kind === "sending"}>
                Remove my timeline
              </Button>
            ) : null}
          </div>{" "}
          {state.kind === "done" ? (
            <p role="status" className="flex items-start gap-2 text-base">
              <CheckIcon size={18} weight="bold" className="mt-1 shrink-0 text-primary-text" aria-hidden="true" /> {state.message}
            </p>
          ) : state.kind === "refused" ? (
            <p role="alert" className="flex items-start gap-2 text-base">
              <WarningIcon size={18} weight="bold" className="mt-1 shrink-0" aria-hidden="true" /> {state.message}
            </p>
          ) : null}
        </form>
      </details>
    </PageSection>
  );
}
