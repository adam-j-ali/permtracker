"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";

import { ScrollBox } from "@/components/ui/scroll-box";
import { scoreLines, type FigureScoreRow, type ScoreLine } from "@/lib/figureScores";
import { api } from "@convex/_generated/api";

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** Our figures against DOL's own, each on DOL's definition, day and scope, with whether it's inside its tolerance. */
export function FigureScoresPanel() {
  const load = useAction(api.adminFigureScores.get);
  const [lines, setLines] = useState<ScoreLine[] | null | "none">(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    load({})
      .then((r) => setLines(r ? scoreLines(JSON.parse(r.json) as FigureScoreRow[]) : "none"))
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [load]);
  return (
    <section aria-labelledby="figure-scores-title">
      <h2 id="figure-scores-title" className="font-heading text-xl font-bold">
        Our figures against DOL&apos;s own
      </h2>{" "}
      {failed ? (
        <p className="mt-3 text-base text-data-bad-ink">The scores couldn&apos;t be read: {failed}</p>
      ) : lines === null ? (
        <p className="mt-3 text-base text-muted-foreground">Reading the scores…</p>
      ) : lines === "none" || lines.length === 0 ? (
        <p className="mt-3 text-base text-muted-foreground">
          No scores yet. They appear after the server&apos;s daily job reads DOL&apos;s Selected Statistics.
        </p>
      ) : (
        <ScrollBox className="mt-4" label="Our figures against DOL's own">
          <table className="w-full min-w-[760px] border-2 border-border text-left text-sm">
            <thead className="bg-tint">
              <tr>
                <th scope="col" className="px-3 py-2">Figure{" "}</th>
                <th scope="col" className="px-3 py-2">As of{" "}</th>
                <th scope="col" className="px-3 py-2 text-right">Ours{" "}</th>
                <th scope="col" className="px-3 py-2 text-right">DOL&apos;s{" "}</th>
                <th scope="col" className="px-3 py-2">Gap{" "}</th>
                <th scope="col" className="px-3 py-2">Inside tolerance{" "}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-t-2 border-border align-top">
                  <th scope="row" className="px-3 py-2 font-bold">
                    {l.title}
                    <span className="block font-normal text-muted-foreground">{l.scope}</span>
                    {l.note ? <span className="block font-normal text-muted-foreground">{l.note}</span> : null}{" "}
                  </th>
                  <td className="px-3 py-2 tabular-nums">{l.asOf}{" "}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(l.ours)}{" "}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(l.theirs)}{" "}</td>
                  <td className="px-3 py-2 tabular-nums">{l.gapText}{" "}</td>
                  <td className={l.within ? "px-3 py-2 font-bold text-data-good-ink" : "px-3 py-2 font-bold text-data-bad-ink"}>
                    {l.within ? "Yes" : "No"} (within {num(l.tolerance)} {l.unit}){" "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
    </section>
  );
}
