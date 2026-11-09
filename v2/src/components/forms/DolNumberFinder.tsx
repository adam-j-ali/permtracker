"use client";

import { useId, useState } from "react";

import { CaseFinder } from "@/components/tools/CaseFinder";

import { useFormSectionContextOptional } from "./useCaseFormSection";

/**
 * Under a DOL case number field in the case form: finds the number in DOL's record from the employer's name
 * and the filing day the form already holds, and fills it in. A case added without its number has no live
 * status to watch, and many filers never saw the number. Opened by a click, so opening a case reads nothing.
 */
export function DolNumberFinder({
  program,
  day,
  onPick,
}: {
  /** PERM cases under the ETA 9089 number, wage requests under the PWD number. */
  program: "perm" | "pwd";
  /** The section's filing date, or nothing yet. */
  day: string | undefined;
  onPick: (caseNumber: string) => void;
}) {
  const form = useFormSectionContextOptional();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="text-sm">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} className="link text-left">
        Find it in DOL&apos;s record
      </button>{" "}
      <div id={panelId} hidden={!open}>
        {open ? (
          <CaseFinder
            className="mt-3"
            programs={[program]}
            day={day ?? ""}
            employer={form?.formData.employerName ?? ""}
            source="case-form"
            pickLabel="Use this number"
            onPick={(c) => {
              onPick(c.caseNumber);
              setOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
