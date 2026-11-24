"use client";

import { useId, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { CheckCircleIcon, FileArrowUpIcon, PaperclipIcon, WarningIcon } from "@phosphor-icons/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { missingProof, stepInSentence, type RecruitmentStep } from "@convex/lib/perm/recruitment/steps";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { fmtISODate } from "../case-detail-utils";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * Each recruitment step the case entered, with the proof the rule names for it and the files that prove it. A file
 * uploaded here is saved as that step's proof; a file already on the case can be named as one. Before the filing
 * window opens, the steps still without proof are listed at the top.
 */
export interface ProofDocument {
  id: string;
  name: string;
  url: string;
  step?: string;
}

const SELECT =
  "flex min-h-11 w-full min-w-0 border-2 border-input bg-card px-3 py-2 text-base shadow-hard-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RecruitmentProof({
  caseId,
  steps,
  documents,
  filingWindowOpens,
  filed,
  onUpload,
}: {
  caseId: Id<"cases">;
  steps: readonly RecruitmentStep[];
  documents: readonly ProofDocument[];
  filingWindowOpens: string | null;
  filed: boolean;
  onUpload: (file: File, category: "recruitment", step: string) => Promise<string | null>;
}) {
  const id = useId();
  const setStep = useMutation(api.documents.setDocumentStep);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const stillMissing = missingProof(steps, documents);
  const loose = documents.filter((d) => !d.step);

  const upload = async (step: RecruitmentStep, file: File | undefined) => {
    if (!file) return;
    setBusy(step.key);
    const problem = await onUpload(file, "recruitment", step.key);
    setBusy(null);
    if (problem) toast.error(problem);
    const input = inputs.current[step.key];
    if (input) input.value = "";
  };

  const name = async (step: RecruitmentStep, documentId: string) => {
    if (!documentId) return;
    try {
      await setStep({ caseId, documentId, step: step.key });
    } catch {
      toast.error("Couldn't attach that file. Try again.");
    }
  };

  if (!steps.length) return null;

  return (
    <section className="detail-card" aria-labelledby={`${id}-h`}>
      <div className="detail-card-head ch-rec">
        <h2 id={`${id}-h`} className="flex items-center gap-1.5">
          <PaperclipIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Proof of each step
        </h2>{" "}
        {stillMissing.length ? (
          <span className="head-badge">{`${stillMissing.length} missing`}</span>
        ) : (
          <span className="head-badge">
            <CheckCircleIcon aria-hidden="true" className="h-2.5 w-2.5" /> Complete
          </span>
        )}
      </div>
      <div className="detail-card-body space-y-4">
        {stillMissing.length && !filed ? (
          <p className="flex gap-2 border-l-4 border-data-warn-ink bg-soft-warn px-4 py-3 text-base" role="status">
            <WarningIcon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              {`${stillMissing.length === 1 ? "One step has" : `${stillMissing.length} steps have`} no proof yet: ${stillMissing
                .map(stepInSentence)
                .join("; ")}.`}
              {filingWindowOpens ? ` The filing window opens ${fmtISODate(filingWindowOpens)}.` : ""}
            </span>
          </p>
        ) : null}
        <ul className="divide-y divide-border">
          {steps.map((s) => {
            const docs = documents.filter((d) => d.step === s.key);
            return (
              <li key={s.key} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-bold">{keepWhole(s.label)}</h3>{" "}
                  <span className="text-sm text-muted-foreground">{s.cite}</span>
                </div>
                <p className="text-sm text-muted-foreground">{s.proof}</p>
                {docs.length ? (
                  <ul className="space-y-1">
                    {docs.map((d) => (
                      <li key={d.id} className="text-base">
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="link">
                          {d.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-base font-semibold">{s.datesAreProof ? "Its dates are its proof." : "No proof attached."}</p>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    ref={(el) => {
                      inputs.current[s.key] = el;
                    }}
                    id={`${id}-${s.key}-file`}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                    className="sr-only"
                    onChange={(e) => void upload(s, e.target.files?.[0])}
                  />
                  <Button type="button" variant="outline" className="min-h-11" disabled={busy === s.key} onClick={() => inputs.current[s.key]?.click()}>
                    <FileArrowUpIcon aria-hidden="true" className="h-4 w-4" /> {busy === s.key ? "Uploading" : "Upload proof"}
                  </Button>{" "}
                  {loose.length ? (
                    <div className="min-w-0 flex-1 sm:max-w-xs">
                      <label htmlFor={`${id}-${s.key}-pick`} className="sr-only">
                        {`Use a file already on the case as proof of the ${stepInSentence(s)}`}
                      </label>
                      <select id={`${id}-${s.key}-pick`} className={SELECT} value="" onChange={(e) => void name(s, e.target.value)}>
                        <option value="">Or use a file already on the case</option>
                        {loose.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
