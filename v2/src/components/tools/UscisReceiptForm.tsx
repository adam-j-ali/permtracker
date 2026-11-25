"use client";

import { useId, useState } from "react";

import { readPartialReceipt, type PartialReceipt } from "@/lib/uscis/receipt";
import { buttonVariants } from "@/components/ui/button";
import { KeepWhole } from "@/components/ui/keep-whole";

/**
 * The receipt box on `/uscis-case-status`, as a plain GET form.
 *
 * Same contract as `CaseLookupForm`: `method="get"` puts the receipt in
 * `?receipt=` so a result has an address, and the page works with JavaScript
 * off. The client half does one thing: says the shape is wrong BEFORE a round
 * trip, and says when the thing typed is a DOL number that belongs on the
 * other page. Neither hint blocks submission; the server is the authority.
 *
 * Since Nov 25 2026 it reads the number as it's typed (readPartialReceipt): the office from three letters, the fiscal
 * year and the series as they arrive, the first character that can't belong by its position, a one-tap fix for the
 * usual typos, and an A-number told apart. A strip under the box shows the number in its parts; the line above it
 * says the same in words, for anyone who can't see the strip.
 */

export interface UscisReceiptFormProps {
  defaultValue?: string;
  className?: string;
  /**
   * Whether the page looks the receipt up at USCIS. Without USCIS's API keys
   * it only decodes the number and keeps nothing, so the help line must not
   * promise a stored answer.
   */
  live?: boolean;
}

/** A DOL FLAG number: letter, dash, digits. Never a USCIS receipt. */
const DOL_SHAPE = /^[A-Z]-\d/i;

/** What the characters typed so far say, in one line. The day digits wait for the result, where their caveat is. */
function readingLine(r: PartialReceipt): string {
  if (!r.prefix) return "A receipt number is three letters, then ten digits.";
  const parts = [r.office ? r.office.name : `${r.prefix}, letters USCIS doesn't list`];
  if (r.series === "online") parts.push("filed online");
  if (r.fiscalYear !== null) parts.push(`fiscal year ${r.fiscalYear}`);
  if (r.series === "lockbox") parts.push("a lockbox number");
  const left = r.remaining > 0 ? ` ${r.remaining} more ${r.remaining === 1 ? "digit" : "digits"}.` : " Look it up for the rest.";
  return `${parts.join(", ")}.${left}`;
}

function problemLine(r: PartialReceipt): string | null {
  if (!r.problem) return null;
  if (r.problem.expected === "end") return `That's ${r.typed.length} characters. A receipt number has 13.`;
  return `Character ${r.problem.position} should be a ${r.problem.expected}.`;
}

/** The number in its parts as far as it's right, each part padded to its length so what's left shows. */
function segments(r: PartialReceipt): { chars: string; size: number; label: string }[] {
  const good = r.problem ? r.typed.slice(0, r.problem.position - 1) : r.typed;
  const part = (from: number, size: number, label: string) => ({ chars: good.slice(from, from + size), size, label });
  if (r.series === "online") return [part(0, 3, "Office"), part(3, 10, "Online count")];
  const start = [part(0, 3, "Office"), part(3, 2, "Year")];
  if (r.series === "lockbox") return [...start, part(5, 8, "Lockbox count")];
  return [...start, part(5, 3, "Day"), part(8, 5, "Sequence")];
}

export function UscisReceiptForm({ defaultValue = "", className, live = false }: UscisReceiptFormProps) {
  const inputId = useId();
  const helpId = useId();
  const consentId = useId();
  const [value, setValue] = useState(defaultValue);
  const [edited, setEdited] = useState(false);

  const typed = value.trim();
  const reading = readPartialReceipt(typed);
  // An A-number written with dashes (A-123-456-789) starts like a DOL number; its eight or nine digits tell it apart
  // (a legacy DOL number has ten), so it's read first.
  const aNumber = edited && typed.length > 0 && reading.otherKind === "a-number";
  const isDol = edited && !aNumber && DOL_SHAPE.test(typed);
  const showReading = edited && typed.length > 0 && !isDol;
  const problem = showReading && !aNumber ? problemLine(reading) : null;
  const malformed = problem !== null || aNumber;

  return (
    <form method="get" action="/uscis-case-status" className={className}>
      <label
        htmlFor={inputId}
        className="block text-sm font-bold text-muted-foreground"
      >
        Your USCIS receipt number
      </label>{" "}
      <div className="mt-2 flex flex-wrap items-stretch gap-3">
        <input
          id={inputId}
          name="receipt"
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setEdited(true);
          }}
          placeholder="EAC2190123456"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={20}
          aria-invalid={malformed || undefined}
          aria-describedby={`${helpId} ${consentId}`}
          className="min-h-[52px] w-full min-w-0 flex-1 basis-72 border-2 border-input bg-background px-4 py-3 font-mono text-lg tracking-tight focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        />{" "}
        <button
          type="submit"
          className={buttonVariants({ size: "lg", className: "h-auto min-h-[52px]" })}
        >
          Look it up
        </button>
      </div>{" "}
      {showReading && !aNumber && reading.typed.length > 0 ? (
        <div aria-hidden="true" className="mt-3 flex flex-wrap gap-2">
          {segments(reading).map((s) => (
            <span key={s.label} className="inline-flex flex-col items-start">
              {" "}
              <span className="border-2 border-border bg-background px-2 py-1 font-mono text-base tracking-[0.2em]">
                {s.chars.padEnd(s.size, "·")}
              </span>{" "}
              <span className="mt-1 text-sm text-muted-foreground">{s.label}</span>
            </span>
          ))}
        </div>
      ) : null}{" "}
      <p id={helpId} className="mt-2 text-sm text-muted-foreground" aria-live="polite">
        {isDol ? (
          <span className="font-bold text-data-warn-ink">
            That&apos;s a Department of Labor number. Submitting takes you to the
            PERM case page, which reads it.
          </span>
        ) : aNumber ? (
          <span className="font-bold text-data-warn-ink">
            <KeepWhole>
              {"That's an A-number, the number USCIS gives a person. A receipt number names one case: three " +
                "letters and ten digits, at the top of the I-797 notice."}
            </KeepWhole>
          </span>
        ) : problem ? (
          <>
            <span className="font-bold text-data-bad-ink">{problem}</span>{" "}
            {reading.suggestion ? (
              <button
                type="button"
                onClick={() => setValue(reading.suggestion ?? value)}
                className="link inline-flex min-h-11 items-center font-bold"
              >
                Use {reading.suggestion}
              </button>
            ) : (
              <><KeepWhole>{"A receipt number is three letters and ten digits, at the top of the I-797 notice."}</KeepWhole></>
            )}
          </>
        ) : showReading ? (
          <span className="font-bold text-foreground">{readingLine(reading)}</span>
        ) : live ? (
          <>
            <KeepWhole>
              {"It's at the top of every I-797 notice USCIS mailed. The number goes into this page's address so " +
                "you can bookmark or share the result. The receipt number and USCIS's answer are kept for twelve " +
                "months after the last lookup. Nothing about you is kept."}
            </KeepWhole>
          </>
        ) : (
          <>
            <KeepWhole>
              {"It's at the top of every I-797 notice USCIS mailed. The number goes into this page's address so " +
                "you can bookmark or share what it encodes."}
            </KeepWhole>
          </>
        )}
      </p>{" "}
      {/* USCIS's Case Status API bars submitting anyone's receipt number without their express consent. */}
      <p id={consentId} className="mt-1 text-sm text-muted-foreground">
        Enter only your own receipt number, or one its owner has asked you to check. By looking it up, you confirm that.
      </p>
    </form>
  );
}
