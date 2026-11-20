"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { WarningIcon } from "@phosphor-icons/react";

import {
  DEGREE_LABELS,
  ESTIMATE_ACCURACY,
  estimateLevel,
  type Degree,
  type LevelEstimate,
  type Occupation,
} from "@/lib/wageLevelEstimate";
import { formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Which level will DOL likely give this job?", under the four levels on /tools/wage-levels. The job's requirements
 * go in as Form ETA-9141 asks them (degree, months of experience, a foreign language, a license, other special
 * skills, supervising, travel) and the level comes out by DOL's own written method (src/lib/wageLevelEstimate.ts),
 * against the occupation's Job Zone and usual education from DOL's yearly table (/api/occupation-basis).
 *
 * An estimate, said so beside the answer with how often the method matched DOL's own decisions. Nothing is sent
 * anywhere: the answer is worked out in the browser, and the job's details never leave the page.
 */

interface BasisRow {
  onetCode: string;
  title: string;
  jobZone: 1 | 2 | 3 | 4 | 5 | null;
  education: Degree | null;
  appendixA: boolean;
  usable: boolean;
}

type Basis = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; soc: string; wageYear: number; rows: BasisRow[] };

const LEVELS = ["I", "II", "III", "IV"] as const;
const DEGREES = Object.keys(DEGREE_LABELS) as Degree[];

export function LevelEstimator({
  soc,
  onLevel,
}: {
  soc: string;
  /** The estimated level that governs, or null while there's none, so the ladder can mark it. */
  onLevel: (level: (typeof LEVELS)[number] | null) => void;
}) {
  const id = useId();
  const [basis, setBasis] = useState<Basis>({ kind: "loading" });
  const [onet, setOnet] = useState<string>("");
  const [degree, setDegree] = useState<Degree>("bachelor");
  const [experience, setExperience] = useState<string>("0");
  const [flags, setFlags] = useState({ foreignLanguage: false, license: false, otherSkills: false, supervises: false, travel: false });

  useEffect(() => {
    let live = true;
    setBasis({ kind: "loading" });
    fetch(`/api/occupation-basis?soc=${encodeURIComponent(soc)}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string; soc?: string; wageYear?: number; occupations?: BasisRow[] } | null;
        if (!live) return;
        if (!r.ok || !j?.ok || !Array.isArray(j.occupations)) {
          setBasis({ kind: "error", message: j?.message ?? "DOL's occupation table couldn't be read just now." });
          return;
        }
        setBasis({ kind: "ready", soc: j.soc ?? soc, wageYear: j.wageYear ?? 0, rows: j.occupations });
        const first = j.occupations.find((o) => o.usable);
        setOnet(first?.onetCode ?? "");
      })
      .catch(() => live && setBasis({ kind: "error", message: "That didn't go through, which usually means the connection dropped." }));
    return () => {
      live = false;
    };
  }, [soc]);

  const months = Number(experience);
  const occupation: Occupation | null = useMemo(() => {
    if (basis.kind !== "ready") return null;
    const row = basis.rows.find((r) => r.onetCode === onet && r.usable);
    return row && row.jobZone && row.education
      ? { soc: basis.soc, onetCode: row.onetCode, title: row.title, jobZone: row.jobZone, education: row.education, appendixA: row.appendixA }
      : null;
  }, [basis, onet]);

  const estimate: LevelEstimate | null = useMemo(() => {
    if (!occupation || !Number.isFinite(months) || months < 0 || months > 600) return null;
    return estimateLevel(occupation, { degree, experienceMonths: months, ...flags });
  }, [occupation, degree, months, flags]);

  useEffect(() => {
    onLevel(estimate ? LEVELS[estimate.governing - 1]! : null);
  }, [estimate, onLevel]);

  const usable = basis.kind === "ready" ? basis.rows.filter((r) => r.usable) : [];

  return (
    <section aria-labelledby={`${id}-h`} className="mt-8 border-2 border-border bg-card p-4 sm:p-5">
      <h3 id={`${id}-h`} className="font-heading text-xl font-bold">
        Which level will DOL likely give this job?
      </h3>{" "}
      <p className="mt-1 max-w-2xl text-base text-muted-foreground">
        Answer as the wage request asks. DOL starts every job at Level I and adds a level for what it requires beyond the
        occupation&apos;s usual entry point.
      </p>{" "}
      {basis.kind === "loading" ? (
        <p className="mt-4 text-base text-muted-foreground">Reading DOL&apos;s occupation table…</p>
      ) : basis.kind === "error" ? (
        <p className="mt-4 flex items-start gap-2 text-base" role="alert">
          <WarningIcon size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" /> {basis.message}
        </p>
      ) : usable.length === 0 ? (
        <p className="mt-4 text-base text-muted-foreground">
          DOL&apos;s table doesn&apos;t give a Job Zone or a usual education for this code, so its level can&apos;t be estimated
          here. DOL decides it from the job&apos;s duties.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
            {usable.length > 1 ? (
              <label className="grid grid-cols-1 gap-1 text-base [&>*]:min-w-0">
                <span className="font-bold">Closest occupation</span>
                <select className="min-h-11 w-full min-w-0 max-w-md border-2 border-input bg-background px-2" value={onet} onChange={(e) => setOnet(e.target.value)}>
                  {usable.map((r) => (
                    <option key={r.onetCode} value={r.onetCode}>
                      {`${r.title} (Job Zone ${r.jobZone})`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="grid grid-cols-1 gap-1 text-base [&>*]:min-w-0">
              <span className="font-bold">Degree the job requires</span>
              <select className="min-h-11 w-full min-w-0 max-w-md border-2 border-input bg-background px-2" value={degree} onChange={(e) => setDegree(e.target.value as Degree)}>
                {DEGREES.map((d) => (
                  <option key={d} value={d}>
                    {DEGREE_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-1 text-base [&>*]:min-w-0">
              <label htmlFor={`${id}-months`} className="font-bold">
                Months of experience the job requires
              </label>
              <input
                id={`${id}-months`}
                type="number"
                inputMode="numeric"
                min={0}
                max={600}
                step={1}
                className="min-h-11 w-40 border-2 border-input bg-background px-2 tabular-nums"
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                aria-describedby={`${id}-exp`}
              />
              <span id={`${id}-exp`} className="text-sm text-muted-foreground">
                24 months is 2 years. Count only what the job requires, not what the worker has.
              </span>
            </div>
            <fieldset className="grid grid-cols-1 gap-2 [&>*]:min-w-0">
              <legend className="mb-1 text-base font-bold">The job also requires</legend>
              {(
                [
                  ["foreignLanguage", "A language other than English"],
                  ["license", "A license or certification"],
                  ["otherSkills", "Other special skills"],
                  ["supervises", "Supervising other employees"],
                  ["travel", "Travel"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex min-h-11 items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={flags[key]}
                    onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>{" "}
          <div aria-live="polite">
            {estimate ? (
              <>
                <p className="text-sm font-bold text-muted-foreground">Likely level</p>{" "}
                <p className="mt-1 font-heading text-3xl font-bold">
                  {`Level ${LEVELS[estimate.governing - 1]}`}
                  {estimate.mayBeHigher ? " " : null}
                  {estimate.mayBeHigher ? <span className="ml-1 text-base font-bold text-muted-foreground">{"or higher"}</span> : null}
                </p>{" "}
                <ol className="mt-3 grid grid-cols-1 gap-2 text-base [&>*]:min-w-0">
                  {estimate.steps.map((s) => (
                    <li key={s.step} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 [&>*]:min-w-0">
                      <span className={cn("font-mono font-bold tabular-nums", s.points > 0 ? "text-foreground" : "text-muted-foreground")}>
                        {`+${s.points}`}
                      </span>{" "}
                      <span>{s.note}</span>
                    </li>
                  ))}
                </ol>{" "}
                <p className="mt-4 text-sm text-muted-foreground">
                  {`An estimate by DOL's own written method. On ${ESTIMATE_ACCURACY.tested.toLocaleString("en-US")} of DOL's PERM wage decisions from ${ESTIMATE_ACCURACY.period}, it matched DOL's level ${formatShare(ESTIMATE_ACCURACY.exact)} of the time and came within one level ${formatShare(ESTIMATE_ACCURACY.withinOne)} of the time. DOL also reads the job's duties, which can move it.`}{" "}
                  <Link href="/guides/how-dol-sets-a-prevailing-wage" className="link">
                    How DOL sets a prevailing wage
                  </Link>
                </p>
              </>
            ) : (
              <p className="text-base text-muted-foreground">Enter the months of experience as a whole number from 0 to 600.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
