"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { CaretRightIcon, PlusIcon, XIcon } from "@phosphor-icons/react";

import { DateInput } from "@/components/forms/DateInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACCOUNT_CODES,
  CATEGORIES,
  COUNTRIES,
  DATE_FIELDS,
  EVENT_FORMS,
  I140_CENTERS,
  APPLICANTS,
  I485_CENTERS,
  MAX_ACCOUNT_EVENTS,
  RFE_FORMS,
  RFE_OUTCOMES,
  RFE_REASONS,
  ROUTES,
  type DateFieldId,
  type TimelineInput,
  formHints,
  isListedCode,
} from "@/lib/communityTimeline";
import { USCIS_OFFICES, isCenter, officePlace } from "@/lib/uscisOffices";

/**
 * The boxes of a shared timeline, used by both forms: the one on a case's page (`variant="case"`) and the one on
 * a USCIS office's page and the timelines page (`variant="open"`).
 *
 * Every box is a date or a pick from a fixed list (convex/lib/communityTimeline.ts); there's no free text.
 * - "case": the case has a PERM, so only the PERM categories are offered, and every date sits in one list.
 * - "open": the I-485's own boxes come first (the office, the filing, biometrics, the interview, the green card),
 *   with the rest behind one fold, so the short form is six or seven boxes. A PERM case number is optional there.
 */

type Set = <K extends keyof TimelineInput>(k: K, v: TimelineInput[K]) => void;

const selectCls =
  "mt-1.5 block h-11 w-full min-w-0 border-2 border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const gridCls = "grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0";
const legendCls = "mb-2 text-base font-semibold";
const foldCls =
  "flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden";

/** The offices, field offices by place first and the centers after, as the picker lists them. */
const OFFICE_OPTIONS = [...USCIS_OFFICES]
  .sort((a, b) => Number(isCenter(a)) - Number(isCenter(b)) || officePlace(a).localeCompare(officePlace(b)))
  .map((o) => ({ code: o.code, label: officePlace(o) }));

/** The I-485's own dates, in the order the short form asks for them. */
const I485_FIRST: readonly DateFieldId[] = ["i485FiledOn", "biometricsOn", "interviewOn", "greenCardOn"];

function Pick({
  id,
  label,
  value,
  empty,
  options,
  onChange,
  className,
}: {
  id: string;
  label: string;
  value: string;
  /** The first option's words, for "no answer"; omit when one must be picked. */
  empty?: string;
  options: readonly { id: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Dates({ uid, ids, form, set }: { uid: string; ids: readonly DateFieldId[]; form: TimelineInput; set: Set }) {
  return (
    <>
      {DATE_FIELDS.filter((f) => ids.includes(f.id)).map((f) => (
        <Fragment key={f.id}>
          {" "}
          <div>
            <Label htmlFor={`${uid}-${f.id}`}>{f.label}</Label>
            <DateInput
              id={`${uid}-${f.id}`}
              value={(form[f.id] as string | null | undefined) ?? ""}
              onChange={(e) => set(f.id, e.target.value || null)}
              className="mt-1.5"
            />
          </div>
        </Fragment>
      ))}
    </>
  );
}

function OfficePick({ uid, form, set }: { uid: string; form: TimelineInput; set: Set }) {
  return (
    <div className="sm:col-span-2">
      <Label htmlFor={`${uid}-office`}>USCIS office handling the I-485</Label>
      <select
        id={`${uid}-office`}
        className={selectCls}
        value={form.fieldOffice ?? ""}
        onChange={(e) => set("fieldOffice", e.target.value || null)}
        aria-describedby={`${uid}-office-hint`}
      >
        <option value="">Not sure</option>
        {OFFICE_OPTIONS.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
      <p id={`${uid}-office-hint`} className="mt-1.5 text-sm text-muted-foreground">
        Your interview notice or a transfer notice names it.
      </p>
    </div>
  );
}

function CenterPick({ uid, form, set }: { uid: string; form: TimelineInput; set: Set }) {
  return (
    <div className="sm:col-span-2">
      <Label htmlFor={`${uid}-i485-center`}>Service center that took in the I-485</Label>
      <select
        id={`${uid}-i485-center`}
        className={selectCls}
        value={form.i485Center ?? ""}
        onChange={(e) => set("i485Center", e.target.value || null)}
        aria-describedby={`${uid}-i485-center-hint`}
      >
        <option value="">Not sure</option>
        {I485_CENTERS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <p id={`${uid}-i485-center-hint`} className="mt-1.5 text-sm text-muted-foreground">
        The receipt&apos;s first three letters name it: LIN Nebraska, SRC Texas, EAC Vermont, WAC California, YSC Potomac,
        MSC or NBC the National Benefits Center. IOE means it was filed online and names none.
      </p>
    </div>
  );
}

type Update = NonNullable<TimelineInput["accountEvents"]>[number];
const OTHER = "__other";
let rowSeq = 0;
const rowId = () => `u${(rowSeq += 1)}`;

/**
 * The dated updates in a person's own USCIS account: each a date, the form it landed on and the code it showed. The
 * code is a pick from the codes filers name most, "Other" with a box to type it, or none when only a date moved.
 */
function AccountUpdates({ uid, form, set }: { uid: string; form: TimelineInput; set: Set }) {
  const events = form.accountEvents ?? [];
  // A stable name for each row, so removing one never hands its "Other" box to the next.
  const [ids, setIds] = useState<string[]>(() => events.map(rowId));
  const [typing, setTyping] = useState<ReadonlySet<string>>(() => new Set());
  const count = events.length;
  useEffect(() => {
    // A saved timeline loaded after the form drew: one name per row it brought.
    if (ids.length !== count) setIds(Array.from({ length: count }, rowId));
  }, [count, ids.length]);

  const write = (next: Update[]) => set("accountEvents", next.length > 0 ? next : null);
  const change = (i: number, patch: Partial<Update>) => write(events.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const add = () => {
    setIds([...ids, rowId()]);
    write([...events, { on: null, form: null, code: null }]);
  };
  const remove = (i: number) => {
    setIds(ids.filter((_, j) => j !== i));
    write(events.filter((_, j) => j !== i));
  };

  return (
    <fieldset className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
      <legend className={legendCls}>Updates in your USCIS account</legend>
      <p className="-mt-1 text-sm leading-relaxed text-muted-foreground">
        Each time your online account showed a new date: the day, the form it was on, and the code, if you saw one. Skip any
        you aren&apos;t sure of.{" "}
        <Link href="/guides/uscis-silent-updates" className="link">
          What the codes are known to mean
        </Link>
        . Or paste your account&apos;s data into the{" "}
        <Link href="/uscis-account-reader" className="link">
          account reader
        </Link>{" "}
        and it fills these in, in your browser.
      </p>{" "}
      {events.map((e, i) => {
        const id = ids[i] ?? `${uid}-u${i}`;
        const code = e?.code ?? "";
        const isOther = typing.has(id) || (code !== "" && !isListedCode(code.toUpperCase()));
        const pick = isOther ? OTHER : code;
        return (
          <Fragment key={id}>
            <fieldset className="border-2 border-border p-3">
              <legend className="px-1 text-sm font-semibold">Account update {i + 1}</legend>
              <div className={gridCls}>
                <div>
                  <Label htmlFor={`${uid}-${id}-on`}>Date it showed</Label>
                  <DateInput id={`${uid}-${id}-on`} value={e?.on ?? ""} onChange={(ev) => change(i, { on: ev.target.value || null })} className="mt-1.5" />
                </div>{" "}
                <Pick
                  id={`${uid}-${id}-form`}
                  label="Form"
                  value={e?.form ?? ""}
                  empty="Not sure"
                  options={EVENT_FORMS}
                  onChange={(v) => change(i, { form: v || null })}
                />{" "}
                <div>
                  <Label htmlFor={`${uid}-${id}-code`}>Code</Label>
                  <select
                    id={`${uid}-${id}-code`}
                    className={selectCls}
                    value={pick}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      const next = new Set(typing);
                      if (v === OTHER) next.add(id);
                      else next.delete(id);
                      setTyping(next);
                      change(i, { code: v === OTHER || v === "" ? null : v });
                    }}
                  >
                    <option value="">No code, only a new date</option>
                    {ACCOUNT_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={OTHER}>Other (type the code)</option>
                  </select>
                </div>{" "}
                {isOther ? (
                  <div>
                    <Label htmlFor={`${uid}-${id}-typed`}>Type the code</Label>
                    <Input
                      id={`${uid}-${id}-typed`}
                      value={code}
                      onChange={(ev) => change(i, { code: ev.target.value.toUpperCase().slice(0, 6) || null })}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={6}
                      className="mt-1.5 font-mono"
                      aria-describedby={`${uid}-${id}-typed-hint`}
                    />
                    <p id={`${uid}-${id}-typed-hint`} className="mt-1.5 text-sm text-muted-foreground">
                      2 to 6 letters and digits, starting with a letter. We look at a typed code before it shows.
                    </p>
                  </div>
                ) : null}
              </div>{" "}
              <button
                type="button"
                onClick={() => remove(i)}
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="size-4" weight="bold" aria-hidden="true" /> Remove account update {i + 1}
              </button>
            </fieldset>{" "}
          </Fragment>
        );
      })}
      {events.length < MAX_ACCOUNT_EVENTS ? (
        <button
          type="button"
          onClick={add}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 border-2 border-foreground bg-card px-4 text-base font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlusIcon className="size-4" weight="bold" aria-hidden="true" /> {events.length === 0 ? "Add an account update" : "Add another update"}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">That&apos;s {MAX_ACCOUNT_EVENTS} updates, the most a timeline keeps.</p>
      )}
    </fieldset>
  );
}

/** What the person might add, under the form. Never blocks a save. */
function Hints({ form }: { form: TimelineInput }) {
  const hints = formHints(form);
  if (hints.length === 0) return null;
  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      <p className="font-semibold text-foreground">Worth adding, if you have it</p>{" "}
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {hints.map((h) => (
          <li key={h}>{h} </li>
        ))}
      </ul>
    </div>
  );
}

function Rfe({ uid, form, set }: { uid: string; form: TimelineInput; set: Set }) {
  return (
    <details className="group/more border-2 border-border p-2" open={Boolean(form.rfeForm)}>
      <summary className={foldCls}>
        <CaretRightIcon className="size-4 shrink-0 transition-transform group-open/more:rotate-90" weight="bold" aria-hidden="true" /> Got a request for
        evidence (RFE)?
      </summary>
      <div className={`mt-3 ${gridCls}`}>
        <Pick id={`${uid}-rfe-form`} label="On which form" value={form.rfeForm ?? ""} empty="No RFE" options={RFE_FORMS} onChange={(v) => set("rfeForm", v || null)} />{" "}
        <Pick id={`${uid}-rfe-reason`} label="What it asked about" value={form.rfeReason ?? ""} empty="Not saying" options={RFE_REASONS} onChange={(v) => set("rfeReason", v || null)} />{" "}
        <div>
          <Label htmlFor={`${uid}-rfe-issued`}>RFE dated</Label>
          <DateInput id={`${uid}-rfe-issued`} value={form.rfeIssuedOn ?? ""} onChange={(e) => set("rfeIssuedOn", e.target.value || null)} className="mt-1.5" />
        </div>{" "}
        <div>
          <Label htmlFor={`${uid}-rfe-resp`}>Response sent</Label>
          <DateInput id={`${uid}-rfe-resp`} value={form.rfeRespondedOn ?? ""} onChange={(e) => set("rfeRespondedOn", e.target.value || null)} className="mt-1.5" />
        </div>{" "}
        <Pick
          id={`${uid}-rfe-out`}
          label="What happened"
          value={form.rfeOutcome ?? ""}
          empty="Not saying"
          options={RFE_OUTCOMES}
          onChange={(v) => set("rfeOutcome", v || null)}
          className="sm:col-span-2"
        />
      </div>
    </details>
  );
}

function Premium({ form, set }: { form: TimelineInput; set: Set }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-base sm:col-span-2">
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-primary"
        checked={form.premium === true}
        onChange={(e) => set("premium", e.target.checked ? true : null)}
      />
      <span>The I-140 was filed with premium processing</span>
    </label>
  );
}

function ShowOnBoard({ form, set, kept }: { form: TimelineInput; set: Set; kept: string }) {
  return (
    <div className="border-2 border-border bg-background p-4">
      <label className="flex min-h-11 items-start gap-3 text-base">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-primary"
          checked={form.public === true}
          onChange={(e) => set("public", e.target.checked)}
        />
        <span>
          <b className="font-semibold">Show my timeline in the public lists.</b> A case number or an employer never shows there. A row is the
          month you filed and how many days each step took.
        </span>
      </label>{" "}
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Either way, once we&apos;ve checked it, your dates count toward the anonymous medians on the{" "}
        <Link href="/green-card-timelines" className="link">
          green card timelines
        </Link>{" "}
        page. {kept}
      </p>
    </div>
  );
}

export function TimelineFormFields({
  uid,
  variant,
  form,
  set,
  caseNumber,
  onCaseNumber,
}: {
  uid: string;
  variant: "case" | "open";
  form: TimelineInput;
  set: Set;
  /** "open" only: the optional PERM case number, as typed. */
  caseNumber?: string;
  onCaseNumber?: (v: string) => void;
}) {
  const route = form.route === "consular" ? "consular" : "adjustment";
  const forRoute = DATE_FIELDS.filter((f) => (f.routes as readonly string[]).includes(route)).map((f) => f.id);
  const kept = "This browser keeps a key for it so you can edit or remove it later.";

  if (variant === "case") {
    return (
      <>
        <fieldset className={gridCls}>
          <legend className={legendCls}>About the case</legend>
          <Pick id={`${uid}-cat`} label="Category" value={form.category ?? ""} empty="Not saying" options={CATEGORIES.filter((c) => c.perm)} onChange={(v) => set("category", v || null)} />{" "}
          <Pick id={`${uid}-country`} label="Country of chargeability" value={form.country ?? ""} empty="Not saying" options={COUNTRIES} onChange={(v) => set("country", v || null)} />{" "}
          <Pick id={`${uid}-applicant`} label="Whose case this is" value={form.applicant ?? ""} empty="Not saying" options={APPLICANTS} onChange={(v) => set("applicant", v || null)} />{" "}
          <Pick id={`${uid}-route`} label="After the I-140" value={route} options={ROUTES} onChange={(v) => set("route", v)} />{" "}
          <Pick id={`${uid}-center`} label="Where the I-140 was decided" value={form.i140Center ?? ""} empty="Not sure" options={I140_CENTERS} onChange={(v) => set("i140Center", v || null)} />{" "}
          {route === "adjustment" ? <OfficePick uid={uid} form={form} set={set} /> : null}{" "}
          {route === "adjustment" ? <CenterPick uid={uid} form={form} set={set} /> : null}{" "}
          <Premium form={form} set={set} />
        </fieldset>{" "}
        <fieldset className={gridCls}>
          <legend className={legendCls}>Dates, only the ones that have happened</legend>
          <Dates uid={uid} ids={forRoute} form={form} set={set} />
        </fieldset>{" "}
        <AccountUpdates uid={uid} form={form} set={set} />{" "}
        <Rfe uid={uid} form={form} set={set} />{" "}
        <Hints form={form} />{" "}
        <ShowOnBoard form={form} set={set} kept={kept} />
      </>
    );
  }

  const first = I485_FIRST.filter((id) => forRoute.includes(id));
  const rest = forRoute.filter((id) => !first.includes(id));
  return (
    <>
      <fieldset className={gridCls}>
        <legend className={legendCls}>{route === "adjustment" ? "Your I-485, only the dates that have happened" : "Your interview abroad, only the dates that have happened"}</legend>
        {route === "adjustment" ? <OfficePick uid={uid} form={form} set={set} /> : null}{" "}
        {route === "adjustment" ? <CenterPick uid={uid} form={form} set={set} /> : null}{" "}
        <Dates uid={uid} ids={first} form={form} set={set} />
      </fieldset>{" "}
      <AccountUpdates uid={uid} form={form} set={set} />{" "}
      <fieldset className={gridCls}>
        <legend className={legendCls}>About the case</legend>
        <Pick id={`${uid}-cat`} label="Category" value={form.category ?? ""} empty="Not saying" options={CATEGORIES} onChange={(v) => set("category", v || null)} />{" "}
        <Pick id={`${uid}-country`} label="Country of chargeability" value={form.country ?? ""} empty="Not saying" options={COUNTRIES} onChange={(v) => set("country", v || null)} />{" "}
        <Pick id={`${uid}-applicant`} label="Whose case this is" value={form.applicant ?? ""} empty="Not saying" options={APPLICANTS} onChange={(v) => set("applicant", v || null)} />
      </fieldset>{" "}
      <details className="group/more border-2 border-border p-2">
        <summary className={foldCls}>
          <CaretRightIcon className="size-4 shrink-0 transition-transform group-open/more:rotate-90" weight="bold" aria-hidden="true" /> More, if you
          have it: the I-140, the work permit, the travel document
        </summary>
        <div className={`mt-3 ${gridCls}`}>
          <Pick id={`${uid}-route`} label="After the I-140" value={route} options={ROUTES} onChange={(v) => set("route", v)} />{" "}
          <Pick id={`${uid}-center`} label="Where the I-140 was decided" value={form.i140Center ?? ""} empty="Not sure" options={I140_CENTERS} onChange={(v) => set("i140Center", v || null)} />{" "}
          <Dates uid={uid} ids={rest} form={form} set={set} />{" "}
          <Premium form={form} set={set} />{" "}
          <div className="sm:col-span-2">
            <Label htmlFor={`${uid}-case`}>PERM case number, if the case has one</Label>
            <Input
              id={`${uid}-case`}
              value={caseNumber ?? ""}
              onChange={(e) => onCaseNumber?.(e.target.value)}
              placeholder="G-100-25324-425560"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="mt-1.5"
              aria-describedby={`${uid}-case-hint`}
            />
            <p id={`${uid}-case-hint`} className="mt-1.5 text-sm text-muted-foreground">
              It lets us add DOL&apos;s own PERM dates. It never shows on any page. Leave it empty for EB-1 or a waiver.
            </p>
          </div>
        </div>
      </details>{" "}
      <Rfe uid={uid} form={form} set={set} />{" "}
      <Hints form={form} />{" "}
      <ShowOnBoard form={form} set={set} kept={kept} />
    </>
  );
}
