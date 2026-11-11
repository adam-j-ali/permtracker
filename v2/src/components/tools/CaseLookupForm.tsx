"use client";

import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRightIcon, CaretDownIcon } from "@phosphor-icons/react";

import { trackLookup } from "@/lib/funnelEvents";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFinderDock } from "@/components/tools/FinderDock";
import { normaliseCaseNumber } from "@/lib/caseNumberShape";
import { looksLikeReceipt } from "@/lib/uscis/receipt";

// Loaded when someone opens it: the homepage carries this box, and most visitors have their number.
const CaseFinder = dynamic(() => import("@/components/tools/CaseFinder").then((m) => m.CaseFinder), {
  loading: () => (
    <p className="mt-3 text-sm text-muted-foreground" role="status">
      Opening the finder.
    </p>
  ),
});

/**
 * The one input on the page, as a plain GET form.
 *
 * NO SUBMIT HANDLER AND NO ROUTER PUSH. `method="get"` puts the number in
 * `?case=` by itself, which is what makes a result shareable and bookmarkable
 * (the thing attorneys asked for on the I-485 review), and it means the page
 * works with JavaScript switched off, which for a government-record lookup is
 * worth more than a slightly smoother transition.
 *
 * The client component earns its keep on one thing only: telling somebody
 * their number is the wrong shape BEFORE they submit and wait on a round
 * trip. That hint never blocks submission, because the server validates again
 * and is the authority, and a client-side gate on a typo is how a valid input
 * with an unusual prefix becomes unenterable.
 *
 * Layout is flex rather than grid on purpose. A form control in a grid with
 * no unprefixed column track is sized from its CONTENT on iOS and from its
 * column everywhere else, which is a phone-only overflow this codebase has
 * already paid for once.
 */

export interface CaseLookupFormProps {
  /** Repopulates the box after a submit, so the URL and the field agree. */
  defaultValue?: string;
  className?: string;
  /** The box's label. Kept for screen readers when `compact` hides it. */
  label?: string;
  /** For a block that already asks the question: the label is read, not shown. */
  compact?: boolean;
  /** Box and button one under the other at every width (a narrow column). */
  stack?: boolean;
  /**
   * The page "Don't have the number?" also offers, and its words. Null leaves the whole line
   * off, the finder with it (the embed, which answers inside its own frame).
   */
  searchHref?: string | null;
  searchLabel?: string;
  /** More ways in for someone with no number, after the two every box offers (an employer's page: follow it by email). */
  more?: ReadonlyArray<{ href: string; label: string }>;
  /** A quiet last line under the ways in ("Free, and no account needed."). */
  footnote?: ReactNode;
  /**
   * The form is the last thing inside a box padded `p-5 sm:p-6` (`.object`): the no-number part becomes the box's
   * tinted foot, edge to edge, and a finder opened in it is drawn flat. A box holds one frame, never a second.
   */
  boxed?: boolean;
  /**
   * The form sits in a box some other way (a box with its own ground or padding, or with more under the form):
   * no foot is drawn, and a finder opened here is still flat, so the box holds one frame.
   */
  flatFinder?: boolean;
  /** The employer whose page this is: the finder opens with the name filled in. */
  employerName?: string;
  /** The kind of filing this page is about: the finder opens on it. PERM cases otherwise. */
  finderProgram?: "perm" | "pwd" | "lca" | "seasonal";
  /** Which page sent the lookup, for the funnel's lookup event. */
  source?: string;
  /** Where the number goes. The embed answers inside its own frame. */
  action?: string;
  /**
   * Words in the empty box, never a whole example number: an example in the muted text colour reads as a number
   * already typed, and the button was being pressed on it. "Case number" unless the box says otherwise.
   */
  placeholder?: string;
  /** What this box's kind of number looks like, said when the typed one is the wrong shape. A PERM number otherwise. */
  example?: string;
  /** The line under the box before anything is typed; null leaves it off. */
  help?: React.ReactNode | null;
  /** The button's word in another language; "Check" otherwise. */
  buttonLabel?: string;
  /** Fields the form carries along unseen (the embed's host site). */
  hiddenFields?: Readonly<Record<string, string>>;
  /**
   * The box also takes an employer's name (the homepage's): the case page
   * sends a name on to the search, so a name typed here is never "the wrong
   * shape", and the box is set in the body face rather than the numbers' mono.
   */
  names?: boolean;
}

/** The button's one word, everywhere a case number is asked for. */
export const CHECK_LABEL = "Check";
/** What a PERM case number looks like. */
const EXAMPLE_NUMBER = "G-100-26125-868956";
/** The empty box's words: a box that takes a name says so. */
const PLACEHOLDER = { number: "Case number", name: "Case number or employer" } as const;
/** What the browser says when the button is pressed with nothing typed. */
const EMPTY_PRESS = { number: "Type your case number first.", name: "Type a case number or an employer's name first." } as const;
/** The opener's words, the same under every box. */
const FINDER_LABEL = "Find it by employer and filing date";
/** The words for the full search, under every box that doesn't name its own next page. */
const SEARCH_LABEL = "Search every filing by employer";

export function CaseLookupForm({
  defaultValue = "",
  className,
  label = "Your PERM case number",
  compact = false,
  stack = false,
  searchHref = "/case-search",
  searchLabel = SEARCH_LABEL,
  more,
  footnote,
  boxed = false,
  flatFinder = false,
  employerName,
  finderProgram,
  source,
  action = "/perm-case-status",
  placeholder,
  example = EXAMPLE_NUMBER,
  help = "It's on your ETA-9089 receipt.",
  buttonLabel = CHECK_LABEL,
  hiddenFields,
  names = false,
}: CaseLookupFormProps) {
  const inputId = useId();
  const helpId = useId();
  const [value, setValue] = useState(defaultValue);
  const [edited, setEdited] = useState(false);

  // An empty box is not a mistake, and the hint stays quiet until something is
  // TYPED: on a submitted bad value the server already says so, and two
  // warnings about one typo is one too many. A USCIS receipt is another
  // agency's number; the server sends a complete one to its own page, and the
  // hint says so first.
  const isReceipt = edited && looksLikeReceipt(value);
  const looksLikeName = names && /[A-Za-z]{2}/.test(value) && (value.match(/[A-Za-z]/g) ?? []).length > (value.match(/\d/g) ?? []).length;
  const malformed =
    edited && !isReceipt && !looksLikeName && value.trim().length > 0 && normaliseCaseNumber(value) === null;
  const hint = isReceipt ? (
    <span className="text-data-warn-ink">
      That looks like a USCIS receipt number, which is USCIS&apos;s record rather than DOL&apos;s.
      Checking it takes you to the USCIS page.
    </span>
  ) : malformed ? (
    <span className="text-data-bad-ink">That isn&apos;t the shape of a case number. They look like {example}.</span>
  ) : (
    help
  );

  return (
    <div className={className}>
      <form
        method="get"
        action={action}
        // A plain GET still navigates; this only records which page sent it and
        // the shape of what was typed (never the number itself).
        onSubmit={(e) => {
          if (!source) return;
          const typed = new FormData(e.currentTarget).get("case");
          trackLookup(source, typeof typed === "string" ? typed : "");
        }}
      >
        <label htmlFor={inputId} className={compact ? "sr-only" : "block text-base font-semibold"}>
          {label}
        </label>{" "}
        <div className={cn("flex flex-wrap items-stretch gap-3", !compact && "mt-2")}>
          <input
            id={inputId}
            name="case"
            type="text"
            defaultValue={defaultValue}
            // The browser's own check, so it holds with or without scripts; with them, the message is ours. The
            // browser stops an empty press before it's a submit (the event doesn't reach the form), so it's
            // counted here, as the empty shape it was counted as when the press went on to an empty case page.
            required
            onInvalid={(e) => {
              e.currentTarget.setCustomValidity(EMPTY_PRESS[names ? "name" : "number"]);
              if (source) trackLookup(source, "");
            }}
            onInput={(e) => e.currentTarget.setCustomValidity("")}
            onChange={(e) => {
              setValue(e.target.value);
              setEdited(true);
            }}
            placeholder={placeholder ?? PLACEHOLDER[names ? "name" : "number"]}
            autoComplete="off"
            autoCapitalize={names ? "none" : "characters"}
            spellCheck={false}
            enterKeyHint="search"
            translate="no"
            maxLength={names ? 120 : 40}
            aria-invalid={malformed || undefined}
            aria-describedby={hint ? helpId : undefined}
            className={cn(
              "h-12 w-full min-w-0 flex-1 border border-input bg-card px-4 text-base placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring",
              stack ? "basis-full" : "basis-56",
              !names && "font-mono",
            )}
          />
          <button
            type="submit"
            data-ph-capture-attribute-cta="case-lookup"
            className={cn(buttonVariants({ size: "lg" }), "h-12 w-full", !stack && "sm:w-auto")}
          >
            {buttonLabel}
          </button>
        </div>
        {hiddenFields
          ? Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)
          : null}
        {hint ? (
          <p id={helpId} className={cn("mt-2 text-sm", compact && !isReceipt && !malformed ? "sr-only" : "text-muted-foreground")}>
            {hint}
          </p>
        ) : null}
      </form>{" "}
      {/* Many people waiting never saw the receipt (the lawyer filed it). The finder sits outside
          the form, so its own boxes are never sent with the number and Enter in them submits nothing. */}
      {searchHref ? (
        <NoNumber
          searchHref={searchHref}
          searchLabel={searchLabel}
          more={more}
          footnote={footnote}
          boxed={boxed}
          flatFinder={flatFinder}
          employerName={employerName}
          program={finderProgram}
          source={source}
        />
      ) : null}
    </div>
  );
}

/**
 * A box's foot: the tint from edge to edge, cancelling the box's own `p-5 sm:p-6` on three sides. The tone step
 * parts "have the number" from "don't have it" with no line between them.
 */
const BOX_FOOT = "-mx-5 -mb-5 mt-5 bg-tint px-5 pb-2 pt-4 dark:bg-muted sm:-mx-6 sm:-mb-6 sm:px-6";
/** One way in, in a line of them: a full-height target at every width, so two never sit on touching lines. */
const WAY = "link inline-flex min-h-11 items-center gap-1.5 text-left";
/**
 * One way in, in a box's foot: a row as wide as the box, its words at the left edge every row shares and its mark
 * at the right (a caret opens something here, an arrow goes to a page). The underline comes with the pointer.
 */
const ROW = "group flex min-h-11 w-full items-center justify-between gap-3 text-left text-base text-foreground";
const ROW_WORDS = "text-balance underline-offset-4 group-hover:underline";
const ROW_MARK = "size-4 shrink-0 text-primary-text";

/**
 * The ways in without a number: the finder, the page the box's host names, and any more the host adds.
 *
 * The finder opens in one of three places. Under a dock (a list page's or a profile's header, whose box is a
 * narrow side column) it opens in the dock's panel, below the header at the page's full width. In a box with no
 * dock it opens flat inside the box's foot. Standing free on a page, it opens under the form as its own card.
 */
function NoNumber({
  searchHref,
  searchLabel,
  more = [],
  footnote,
  boxed,
  flatFinder,
  employerName,
  program,
  source,
}: {
  searchHref: string;
  searchLabel: string;
  more?: ReadonlyArray<{ href: string; label: string }>;
  footnote?: ReactNode;
  boxed: boolean;
  flatFinder: boolean;
  employerName?: string;
  program?: "perm" | "pwd" | "lca" | "seasonal";
  source?: string;
}) {
  const dock = useFinderDock();
  const [ownOpen, setOwnOpen] = useState(false);
  const ownPanelId = useId();
  const open = dock ? dock.open : ownOpen;
  const toggle = dock ? dock.toggle : () => setOwnOpen((o) => !o);
  const controls = dock ? dock.panelId : ownPanelId;
  const flat = (boxed || flatFinder) && !dock;
  const finder = open ? (
    <CaseFinder
      className={cn("text-left text-foreground", flat ? "mt-1 border-t-2 border-border pb-2 pt-4" : dock ? undefined : "mt-3")}
      heading="Find your case without the number"
      flat={flat}
      autoFocus
      employer={employerName}
      program={program}
      source={source ? `${source}-finder` : "case-lookup-finder"}
    />
  ) : null;
  return (
    <div className={cn("text-sm", boxed ? BOX_FOOT : "mt-2")}>
      {boxed ? (
        <>
          {/* In a box the question is the foot's label and each way in is a row under it: one left edge, one
              rhythm, the finder first and heavier because it's the one that answers here. */}
          <p className="font-semibold text-foreground">Don&apos;t have the number?</p>{" "}
          <ul className="mt-1">
            <li>
              <button type="button" aria-expanded={open} aria-controls={controls} onClick={toggle} className={cn(ROW, "font-semibold")}>
                <span className={ROW_WORDS}>{FINDER_LABEL}</span>
                <CaretDownIcon aria-hidden="true" weight="bold" className={cn(ROW_MARK, open && "rotate-180")} />
              </button>
            </li>{" "}
            {[{ href: searchHref, label: searchLabel }, ...more].map((m) => (
              <li key={m.href}>
                <Link href={m.href} className={ROW}>
                  <span className={ROW_WORDS}>{m.label}</span>
                  <ArrowRightIcon aria-hidden="true" weight="bold" className={ROW_MARK} />
                </Link>{" "}
              </li>
            ))}
          </ul>
        </>
      ) : (
        // On a bare page they run in one line with the question. Each is still its own full-height target: set
        // in one sentence they sat on touching lines on a phone.
        <p className="flex flex-wrap items-center gap-x-5">
          <span className="text-muted-foreground">Don&apos;t have the number?</span>{" "}
          <button type="button" aria-expanded={open} aria-controls={controls} onClick={toggle} className={WAY}>
            {FINDER_LABEL}
            <CaretDownIcon aria-hidden="true" weight="bold" className={cn("size-4 shrink-0", open && "rotate-180")} />
          </button>{" "}
          <Link href={searchHref} className={WAY}>
            {searchLabel}
          </Link>
          {more.map((m) => (
            <span key={m.href} className="contents">
              {" "}
              <Link href={m.href} className={WAY}>
                {m.label}
              </Link>
            </span>
          ))}
        </p>
      )}{" "}
      {footnote ? <p className="pb-1 text-muted-foreground">{footnote}</p> : null}
      {dock ? (
        // The dock's panel is on the page from the first render; the finder is drawn into it once it's opened.
        finder && dock.panel ? createPortal(finder, dock.panel) : null
      ) : (
        <div id={ownPanelId} hidden={!open}>
          {finder}
        </div>
      )}
    </div>
  );
}
