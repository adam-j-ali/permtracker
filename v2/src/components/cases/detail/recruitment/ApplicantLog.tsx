"use client";

import { useId, useState } from "react";
import { useMutation } from "convex/react";
import { PencilSimpleIcon, PlusIcon, TrashIcon, UsersIcon } from "@phosphor-icons/react";

import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
  APPLICANT_OUTCOMES,
  APPLICANT_REASON_MAX,
  APPLICANT_REF_MAX,
  CONTACT_METHODS,
  outcomeLabel,
  type ApplicantOutcome,
  type ContactMethod,
} from "@convex/lib/perm/recruitment/applicantReport";
import { recruitmentStep, type RecruitmentStep } from "@convex/lib/perm/recruitment/steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollBox } from "@/components/ui/scroll-box";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { fmtISOShort } from "../case-detail-utils";

/**
 * A case's applicant log: one row per U.S. applicant, the record the recruitment report counts (20 CFR 656.17(g)).
 * The form asks for a reference, never a name or contact details, and the person filling it writes every reason:
 * nothing here judges an applicant.
 */
type Applicant = Doc<"recruitmentApplicants">;

interface Draft {
  ref: string;
  appliedOn: string;
  source: string;
  contactedOn: string;
  contactMethod: ContactMethod | "";
  outcome: ApplicantOutcome;
  reason: string;
}

const EMPTY: Draft = { ref: "", appliedOn: "", source: "", contactedOn: "", contactMethod: "", outcome: "pending", reason: "" };

const SELECT =
  "flex min-h-11 w-full min-w-0 border-2 border-input bg-card px-3 py-2 text-base shadow-hard-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function toDraft(a: Applicant): Draft {
  return {
    ref: a.ref,
    appliedOn: a.appliedOn ?? "",
    source: a.source ?? "",
    contactedOn: a.contactedOn ?? "",
    contactMethod: a.contactMethod ?? "",
    outcome: a.outcome,
    reason: a.reason ?? "",
  };
}

export function ApplicantLog({
  caseId,
  applicants,
  steps,
}: {
  caseId: Id<"cases">;
  applicants: readonly Applicant[] | undefined;
  steps: readonly RecruitmentStep[];
}) {
  const id = useId();
  const add = useMutation(api.recruitmentApplicants.add);
  const update = useMutation(api.recruitmentApplicants.update);
  const remove = useMutation(api.recruitmentApplicants.remove);
  const [editing, setEditing] = useState<Id<"recruitmentApplicants"> | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirming, setConfirming] = useState<Id<"recruitmentApplicants"> | null>(null);
  const [saving, setSaving] = useState(false);

  const open = (a?: Applicant) => {
    setEditing(a ? a._id : "new");
    setDraft(a ? toDraft(a) : { ...EMPTY, ref: `Applicant ${(applicants?.length ?? 0) + 1}` });
  };

  const save = async () => {
    setSaving(true);
    const fields = {
      ref: draft.ref,
      outcome: draft.outcome,
      ...(draft.appliedOn ? { appliedOn: draft.appliedOn } : {}),
      ...(draft.source ? { source: draft.source } : {}),
      ...(draft.contactedOn ? { contactedOn: draft.contactedOn } : {}),
      ...(draft.contactMethod ? { contactMethod: draft.contactMethod } : {}),
      ...(draft.reason.trim() ? { reason: draft.reason } : {}),
    };
    try {
      if (editing === "new") await add({ caseId, ...fields });
      else if (editing) await update({ id: editing, ...fields });
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message.replace(/^.*ConvexError: /, "") : "Couldn't save the applicant. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const drop = async (a: Applicant) => {
    try {
      await remove({ id: a._id });
      setConfirming(null);
    } catch {
      toast.error("Couldn't remove the applicant. Try again.");
    }
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const notHired = draft.outcome !== "hired" && draft.outcome !== "pending";

  return (
    <section className="detail-card" aria-labelledby={`${id}-h`}>
      <div className="detail-card-head ch-rec">
        <h2 id={`${id}-h`} className="flex items-center gap-1.5">
          <UsersIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Applicants
        </h2>
        {applicants?.length ? <span className="head-badge">{applicants.length}</span> : null}
      </div>
      <div className="detail-card-body space-y-4">
        <p className="text-base text-muted-foreground">
          Log each U.S. applicant here and the recruitment report counts them. Use a reference you&apos;ll recognize, such
          as Applicant 1: the log asks for no names or contact details.
        </p>
        {applicants === undefined ? (
          <p className="text-base">Loading the log.</p>
        ) : applicants.length === 0 ? (
          <p className="text-base">No applicants yet.</p>
        ) : (
          <ScrollBox label="The applicant log">
            <table className="w-full min-w-[640px] border-collapse text-base">
              <thead>
                <tr className="border-b-2 border-border text-left">
                  <th scope="col" className="p-2 font-bold">Reference{" "}</th>
                  <th scope="col" className="p-2 font-bold">Applied{" "}</th>
                  <th scope="col" className="p-2 font-bold">Contacted{" "}</th>
                  <th scope="col" className="p-2 font-bold">Outcome{" "}</th>
                  <th scope="col" className="p-2 font-bold">
                    <span className="sr-only">Change or remove</span>{" "}
                  </th>
                </tr>
              </thead>
              <tbody>
                {applicants.map((a) => (
                  <tr key={a._id} className="border-b border-border/50 align-top">
                    <td className="p-2 font-semibold">{`${a.ref} `}</td>
                    <td className="p-2">
                      {`${a.appliedOn ? fmtISOShort(a.appliedOn) : "-"} `}
                      {a.source ? <span className="block text-sm text-muted-foreground">{`${recruitmentStep(a.source)?.label ?? a.source} `}</span> : null}
                    </td>
                    <td className="p-2">
                      {`${a.contactedOn ? fmtISOShort(a.contactedOn) : "-"} `}
                      {a.contactMethod ? (
                        <span className="block text-sm text-muted-foreground">{`${CONTACT_METHODS.find((m) => m.key === a.contactMethod)?.label ?? ""} `}</span>
                      ) : null}
                    </td>
                    <td className="p-2">
                      {`${outcomeLabel(a.outcome)} `}
                      {a.reason ? <span className="block text-sm text-muted-foreground">{`${a.reason} `}</span> : null}
                    </td>
                    <td className="p-2">
                      {confirming === a._id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm">{`Remove ${a.ref}?`}</span>{" "}
                          <Button type="button" variant="destructive" size="sm" className="min-h-11" onClick={() => void drop(a)}>
                            Remove
                          </Button>{" "}
                          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setConfirming(null)}>
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <span className="flex gap-1">
                          <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={() => open(a)} aria-label={`Change ${a.ref}`}>
                            <PencilSimpleIcon aria-hidden="true" className="h-4 w-4" />
                          </Button>{" "}
                          <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={() => setConfirming(a._id)} aria-label={`Remove ${a.ref}`}>
                            <TrashIcon aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollBox>
        )}

        {editing ? (
          <form
            className="space-y-4 border-2 border-border p-4"
            aria-label={editing === "new" ? "Add an applicant" : `Change ${draft.ref}`}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <div>
                <label htmlFor={`${id}-ref`} className="mb-1 block text-base font-semibold">Reference</label>
                <Input id={`${id}-ref`} value={draft.ref} maxLength={APPLICANT_REF_MAX} required onChange={(e) => set("ref", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`${id}-outcome`} className="mb-1 block text-base font-semibold">Outcome</label>
                <select id={`${id}-outcome`} className={SELECT} value={draft.outcome} onChange={(e) => set("outcome", e.target.value as ApplicantOutcome)}>
                  {APPLICANT_OUTCOMES.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-applied`} className="mb-1 block text-base font-semibold">Applied on</label>
                <Input id={`${id}-applied`} type="date" value={draft.appliedOn} onChange={(e) => set("appliedOn", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`${id}-source`} className="mb-1 block text-base font-semibold">Answered</label>
                <select id={`${id}-source`} className={SELECT} value={draft.source} onChange={(e) => set("source", e.target.value)}>
                  <option value="">Not known</option>
                  {steps.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-contacted`} className="mb-1 block text-base font-semibold">Contacted on</label>
                <Input id={`${id}-contacted`} type="date" value={draft.contactedOn} onChange={(e) => set("contactedOn", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`${id}-how`} className="mb-1 block text-base font-semibold">How</label>
                <select id={`${id}-how`} className={SELECT} value={draft.contactMethod} onChange={(e) => set("contactMethod", e.target.value as ContactMethod | "")}>
                  <option value="">Not contacted yet</option>
                  {CONTACT_METHODS.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-reason`} className="mb-1 block text-base font-semibold">
                {notHired ? "The lawful, job-related reason" : "Notes"}
              </label>
              <Textarea
                id={`${id}-reason`}
                value={draft.reason}
                maxLength={APPLICANT_REASON_MAX}
                rows={3}
                aria-describedby={`${id}-reason-note`}
                onChange={(e) => set("reason", e.target.value)}
              />
              <p id={`${id}-reason-note`} className={cn("mt-1 text-sm text-muted-foreground")}>
                {notHired
                  ? "Write it as the report will say it, tied to the job's stated requirements. A worker who could learn the job's skills with a reasonable period of on-the-job training counts as qualified (20 CFR 656.17(g)(2)). This is general information from the rule."
                  : `Up to ${APPLICANT_REASON_MAX} characters.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11" disabled={saving}>
                {editing === "new" ? "Add applicant" : "Save"}
              </Button>{" "}
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" className="min-h-11" onClick={() => open()}>
            <PlusIcon aria-hidden="true" className="h-4 w-4" /> Add an applicant
          </Button>
        )}
      </div>
    </section>
  );
}
