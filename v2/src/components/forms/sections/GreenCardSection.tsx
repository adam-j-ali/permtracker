"use client";

/**
 * The case form's green card section: past the I-140, to the card.
 *
 * First the adjustment-or-consulate choice, drawn as the two paths' own steps so the choice shows what it means.
 * Then the country of birth and the chargeability country, which can differ, and the visa bulletin line they put
 * the case in. Then the chosen path's dates (the I-485 with the work permit and travel document, or the National
 * Visa Center, the DS-260 and the interview), and the card on either path.
 *
 * Every rule here is read from convex/lib/perm/greenCard.ts: the field names, the labels, the path the dates
 * belong to when no choice was made, the bulletin row and column.
 */

import * as React from "react";
import { AirplaneTiltIcon, ArrowRightIcon, IdentificationCardIcon } from "@phosphor-icons/react";

import { FormField } from "@/components/forms/FormField";
import { DateInput } from "@/components/forms/DateInput";
import { Input } from "@/components/ui/input";
import { CharLimit } from "@/components/ui/char-limit";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";
import { STAGE_VISUALS } from "@/components/status/stage-visuals";
import { useI140Section } from "@/components/forms/useCaseFormSection";
import type { CaseFormData } from "@/lib/forms/case-form-schema";
import type { DateConstraint } from "@/lib/forms/date-constraints";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { lineName } from "@/lib/bulletinLines";
import { describeTypedReceipt } from "@/lib/uscis/receipt";
import { EXAMPLE_ONLINE_RECEIPT } from "@/lib/uscis/exampleReceipts";
import { cn } from "@/lib/utils";
import {
  GREEN_CARD_FIELD_LABELS,
  GREEN_CARD_PATH_LABELS,
  bulletinCategoryOf,
  bulletinCountryOf,
  chargeabilityOf,
  greenCardPathOf,
  hasGreenCardDates,
  type GreenCardPath,
} from "@/lib/perm";

type DateField =
  | "i485FilingDate"
  | "i485ReceiptDate"
  | "i485BiometricsDate"
  | "i485InterviewDate"
  | "i485ApprovalDate"
  | "eadFilingDate"
  | "eadApprovalDate"
  | "apFilingDate"
  | "apApprovalDate"
  | "nvcReceivedDate"
  | "ds260SubmittedDate"
  | "consularInterviewDate"
  | "cardProducedDate"
  | "cardReceivedDate";

type ReceiptField = "i485ReceiptNumber" | "eadReceiptNumber" | "apReceiptNumber";

/** A native select drawn like the form's other boxes: 16px on a phone (iOS zooms below it) and 44px tall. */
const SELECT_CLASS = cn(
  "flex min-h-11 w-full min-w-0 border-2 border-input bg-background px-3 py-2 text-base md:text-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "transition-colors shadow-hard-sm",
);

/** What each path's steps are called in its picture. */
const PATH_STEPS: Record<GreenCardPath, readonly string[]> = {
  adjustment: ["I-485 filed", "Fingerprints", "Interview, if called", "Approved", "Card"],
  consular: ["Visa Center", "DS-260", "Interview", "Visa and entry", "Card"],
};

const PATH_ICON: Record<GreenCardPath, typeof IdentificationCardIcon> = {
  adjustment: IdentificationCardIcon,
  consular: AirplaneTiltIcon,
};

/** The stage colour each path is drawn in, the same as its stage everywhere else. */
const PATH_STAGE: Record<GreenCardPath, "i485" | "consular"> = { adjustment: "i485", consular: "consular" };

/** What a path's choice says beneath its title, in one sentence. */
const PATH_NOTE: Record<GreenCardPath, string> = {
  adjustment: "For someone in the US. The work permit and travel document are usually filed with it.",
  consular: "For someone abroad, or who chooses to finish at a consulate. The card follows entry to the US.",
};

export interface GreenCardSectionProps {
  values?: Partial<CaseFormData>;
  errors?: Record<string, string>;
  dateConstraints?: Record<string, DateConstraint>;
  onChange?: (field: keyof CaseFormData, value: string | number | boolean | undefined) => void;
  onDateChange?: (field: keyof CaseFormData, value: string) => void;
  onBlur?: (field: string, value: string | undefined) => void;
}

/** The adjustment-or-consulate choice, as the two paths' steps side by side. */
function PathChoice({
  chosen,
  following,
  onPick,
}: {
  chosen: GreenCardPath | undefined;
  /** The path the dates put the case on when no choice was made. */
  following: GreenCardPath | undefined;
  onPick: (path: GreenCardPath | undefined) => void;
}) {
  const headingId = React.useId();
  const shown = chosen ?? following;
  return (
    <div className="space-y-2">
      <p id={headingId} className="text-sm font-semibold">
        The path to the green card
      </p>{" "}
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-1 gap-3 [&>*]:min-w-0 md:grid-cols-2">
        {(["adjustment", "consular"] as const).map((path) => {
          const Icon = PATH_ICON[path];
          const visual = STAGE_VISUALS[PATH_STAGE[path]];
          const titleId = `${headingId}-${path}-title`;
          const stepsId = `${headingId}-${path}-steps`;
          const on = shown === path;
          return (
            <label
              key={path}
              className={cn(
                "flex cursor-pointer flex-col border-2 bg-card transition-colors focus-within:ring-2 focus-within:ring-ring",
                on ? visual.border : "border-border hover:bg-accent",
              )}
            >
              <span aria-hidden="true" className={cn("block h-1.5", visual.fill)} />
              <span className="flex items-start gap-3 p-3">
                <input
                  type="radio"
                  name="greenCardPath"
                  value={path}
                  checked={chosen === path}
                  onChange={() => onPick(path)}
                  aria-labelledby={titleId}
                  aria-describedby={stepsId}
                  className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 space-y-2">
                  <span id={titleId} className="flex items-center gap-2 font-semibold">
                    <Icon aria-hidden="true" className={cn("size-5 shrink-0", visual.ink)} weight="bold" />
                    {keepWhole(GREEN_CARD_PATH_LABELS[path])}
                  </span>{" "}
                  <span id={stepsId} className="block space-y-2">
                    <span className="block text-sm text-soft">{keepWhole(PATH_NOTE[path])}</span>{" "}
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                      {PATH_STEPS[path].map((step, i) => (
                        <React.Fragment key={step}>
                          {i > 0 ? <ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                          <span className="bg-tint px-1.5 py-0.5">{keepWhole(step)}</span>{" "}
                        </React.Fragment>
                      ))}
                    </span>
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>{" "}
      {chosen ? (
        <button
          type="button"
          onClick={() => onPick(undefined)}
          className="min-h-11 text-sm font-semibold underline underline-offset-4"
        >
          Clear the choice
        </button>
      ) : following ? (
        <p className="text-sm text-soft">
          {keepWhole(`Not chosen yet. The dates entered put the case on the ${following === "consular" ? "consulate" : "I-485"} path.`)}
        </p>
      ) : (
        <p className="text-sm text-soft">Not chosen yet. Pick one when the case gets there.</p>
      )}
    </div>
  );
}

export function GreenCardSection(props: GreenCardSectionProps) {
  const { values, errors, dateConstraints, onChange, onDateChange, onBlur } = useI140Section(props);

  const following = greenCardPathOf({ ...values, greenCardPath: undefined });
  const path = values.greenCardPath ?? following;
  const category = bulletinCategoryOf(values);
  const column = bulletinCountryOf(chargeabilityOf(values));
  const line = category && column ? lineName(category, column) : null;

  const dateField = (field: DateField, hint?: string) => {
    const constraint = dateConstraints?.[field];
    return (
      <FormField key={field} label={GREEN_CARD_FIELD_LABELS[field]} name={field} error={errors?.[field]} hint={constraint?.hint || hint}>
        <DateInput
          id={field}
          name={field}
          value={values[field] || ""}
          onChange={(e) => {
            const value = e.target.value;
            onChange(field, value || undefined);
            onDateChange(field, value);
          }}
          onBlur={(e) => onBlur(field, e.target.value || undefined)}
          minDate={constraint?.min}
          maxDate={constraint?.max}
          error={!!errors?.[field]}
        />
      </FormField>
    );
  };

  const receiptField = (field: ReceiptField) => {
    const read = describeTypedReceipt(values[field] || "");
    const hint = !read
      ? "USCIS receipt number (optional)"
      : read.tone === "warn"
        ? <span className="text-data-warn-ink">{keepWhole(read.text)}</span>
        : keepWhole(read.text);
    return (
      <FormField key={field} label={GREEN_CARD_FIELD_LABELS[field]} name={field} error={errors?.[field]} hint={hint}>
        <CharLimit max={50}>
          <Input
            id={field}
            name={field}
            type="text"
            value={values[field] || ""}
            onChange={(e) => onChange(field, e.target.value || undefined)}
            aria-invalid={!!errors?.[field]}
            placeholder={`e.g., ${EXAMPLE_ONLINE_RECEIPT}`}
          />
        </CharLimit>
      </FormField>
    );
  };

  const countrySelect = (field: "countryOfBirth" | "chargeabilityCountry", empty: string, hint: string) => (
    <FormField label={GREEN_CARD_FIELD_LABELS[field]} name={field} error={errors?.[field]} hint={hint}>
      <select
        id={field}
        name={field}
        value={values[field] || ""}
        onChange={(e) => onChange(field, e.target.value || undefined)}
        className={cn(SELECT_CLASS, errors?.[field] && "border-destructive")}
        aria-invalid={!!errors?.[field]}
      >
        <option value="">{empty}</option>
        {COUNTRY_OPTIONS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </FormField>
  );

  return (
    <div className="space-y-6">
      <PathChoice chosen={values.greenCardPath} following={following} onPick={(p) => onChange("greenCardPath", p)} />

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0 md:grid-cols-2">
          {countrySelect("countryOfBirth", "Not set", "Where the person was born (optional)")}
          {countrySelect(
            "chargeabilityCountry",
            "Same as country of birth",
            "Set only when the case is charged to another country, such as a spouse's",
          )}
        </div>{" "}
        <p className="text-sm">
          <span className="font-semibold">Visa bulletin line:</span>{" "}
          {line ? (
            <KeepWhole>{line}</KeepWhole>
          ) : (
            <span className="text-soft">
              {keepWhole(
                category
                  ? "Add the country of birth to name it."
                  : "Pick the preference category in the I-140 section and add the country of birth to name it.",
              )}
            </span>
          )}
        </p>
      </div>

      {path === "adjustment" ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold"><KeepWhole>{"Adjustment of status (I-485)"}</KeepWhole></h3>
          <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0 md:grid-cols-2">
            {dateField("i485FilingDate", "When USCIS received the I-485")}
            {dateField("i485ReceiptDate", "The date on the receipt notice (optional)")}
            {receiptField("i485ReceiptNumber")}
            {dateField("i485BiometricsDate", "The fingerprint appointment (optional)")}
            {dateField("i485InterviewDate", "Only when USCIS calls one (optional)")}
            {dateField("i485ApprovalDate", "The date on the approval notice")}
          </div>
          <h3 className="text-sm font-semibold"><KeepWhole>{"Work permit (I-765) and travel document (I-131)"}</KeepWhole></h3>
          <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0 md:grid-cols-2">
            {dateField("eadFilingDate", "Usually filed with the I-485 (optional)")}
            {receiptField("eadReceiptNumber")}
            {dateField("eadApprovalDate", "The date on the approval notice (optional)")}
            {dateField("apFilingDate", "Usually filed with the I-485 (optional)")}
            {receiptField("apReceiptNumber")}
            {dateField("apApprovalDate", "The date on the approval notice (optional)")}
          </div>
        </div>
      ) : null}

      {path === "consular" ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Immigrant visa at a consulate</h3>
          <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0 md:grid-cols-2">
            {dateField("nvcReceivedDate", "The date on the National Visa Center's welcome letter (optional)")}
            {dateField("ds260SubmittedDate", "When the immigrant visa application went in")}
            {dateField("consularInterviewDate", "The interview at the consulate")}
          </div>
        </div>
      ) : null}

      {path || hasGreenCardDates(values) ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">The card</h3>
          <div className="grid grid-cols-1 gap-4 [&>*]:min-w-0 md:grid-cols-2">
            {dateField("cardProducedDate", "When USCIS says the card was made (optional)")}
            {dateField("cardReceivedDate", "When it arrived. This completes the case.")}
          </div>
        </div>
      ) : null}
    </div>
  );
}
