"use client";

/**
 * How long the I-485 and the work permit take, on the case page's green card tab: three kinds of figure for each
 * step, each named and marked with its kind (`data-source-kind`, the way every figure card on the site is): USCIS's
 * posted time, our count of the receipts we check, and the cases people reported. Each is read against the case's
 * own dates while the step is pending (src/lib/caseStepEstimates.ts).
 *
 * The figures come from /api/step-estimates, which takes no case data, so the case's dates stay in the page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { HourglassMediumIcon } from "@phosphor-icons/react";

import { Figure, FigureRow } from "@/components/data/FigureRow";
import { KeepWhole } from "@/components/ui/keep-whole";
import { stepEstimates, type EstimateCaseDates, type EstimateStep, type StepFiguresPayload } from "@/lib/caseStepEstimates";

const STEPS: readonly { step: EstimateStep; title: string }[] = [
  { step: "i485", title: "The I-485" },
  { step: "ead", title: "The work permit (I-765)" },
];

export function StepEstimatesCard({ caseData }: { caseData: EstimateCaseDates }) {
  const [figures, setFigures] = useState<StepFiguresPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/step-estimates")
      .then(async (r) => {
        if (!r.ok) throw new Error(`step estimates ${r.status}`);
        const body = (await r.json()) as Partial<StepFiguresPayload>;
        if (!body.steps?.i485 || !body.steps.ead) throw new Error("step estimates: no figures");
        if (live) setFigures({ steps: body.steps, unreadable: body.unreadable ?? [] });
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-label="How long these steps take" className="detail-card">
      <div className="detail-card-head ch-i485">
        <h2 className="flex items-center gap-1.5">
          <HourglassMediumIcon className="h-3.5 w-3.5" aria-hidden="true" />
          How long these steps take
        </h2>
      </div>
      <div className="space-y-5 p-4">
        <p className="text-sm text-soft">
          Three kinds of figure, each named: USCIS&rsquo;s own posted time, our count of the receipts we check, and the
          cases people reported. Each is dated, and none is a promise about your case.
        </p>{" "}
        {failed ? (
          <p className="text-sm text-data-warn-ink">The figures couldn&rsquo;t be read just now. Try again in a minute.</p>
        ) : !figures ? (
          <p className="text-sm text-soft">Reading the figures&hellip;</p>
        ) : (
          STEPS.map(({ step, title }) => (
            <div key={step} className="space-y-2">
              <h3 className="text-sm font-semibold">
                <KeepWhole>{title}</KeepWhole>
              </h3>{" "}
              <FigureRow>
                {stepEstimates(step, figures, caseData).map((f) => (
                  <Figure key={f.kind} kind={f.kind} label={f.label} value={f.value} note={f.note} />
                ))}
              </FigureRow>
            </div>
          ))
        )}{" "}
        <p className="text-sm">
          <Link href="/uscis-processing-times/i-485" className="link">
            <KeepWhole>{"I-485 processing time"}</KeepWhole>
          </Link>
          {", "}
          <Link href="/uscis-processing-times/i-765" className="link">
            <KeepWhole>{"I-765 processing time"}</KeepWhole>
          </Link>
          {" and "}
          <Link href="/green-card-timelines" className="link">
            Reported green card timelines
          </Link>
        </p>
      </div>
    </section>
  );
}
