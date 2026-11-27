"use client";

import { Fragment, useEffect, useState } from "react";

import { choiceVariants } from "@/components/ui/choice";
import { keepWhole } from "@/components/ui/keep-whole";
import { ShareLine } from "@/components/updates/ShareLine";
import { BlockStatusCard } from "@/components/uscis/BlockStatusCard";
import { BLOCK_FORM_WORDS, decidedOn, type BlockFormChoice } from "@/lib/uscisSample";

/** The event a form choice sends, so other parts of the page follow it. */
export const BLOCK_FORM_EVENT = "pt-block-form";

/** The commonest forms that get a button of their own beside every form together. */
const QUICK = 5;

/**
 * A receipt block's card with a choice of form: every form together, or one (people pass around one form's picture,
 * a block's work permits, Nov 26 2026). The chosen form goes in the address (#form=I-765), so a shared link opens on
 * it, and the share line under the card names it.
 */
export function BlockStatusChooser({
  block,
  asOf,
  every,
  choices,
  lines,
  received,
  blockCases,
}: {
  block: string;
  asOf: string;
  every: boolean;
  choices: BlockFormChoice[];
  /** Each choice's line to paste into a chat, by its key. */
  lines: Record<string, string>;
  received?: { from: string; to: string };
  /** The block's cases of every form. */
  blockCases?: number;
}) {
  const [key, setKey] = useState("all");
  useEffect(() => {
    const m = /(?:^|[#&])form=([A-Za-z0-9-]+)/.exec(window.location.hash);
    const want = m?.[1]?.toUpperCase();
    if (want && choices.some((c) => c.key === want)) setKey(want);
  }, [choices]);
  const choose = (k: string) => {
    setKey(k);
    const url = `${window.location.pathname}${window.location.search}${k === "all" ? "" : `#form=${k}`}`;
    window.history.replaceState(window.history.state, "", url);
    // The blocks-either-side chart lower on the page follows the same form.
    window.dispatchEvent(new CustomEvent(BLOCK_FORM_EVENT, { detail: k }));
  };
  const shown = choices.find((c) => c.key === key) ?? choices[0];
  if (!shown) return null;
  const parent = decidedOn(shown.key);
  // Every form together and the commonest few as buttons, the rest in one list: a block can hold 20 forms, and a
  // button each pushed the card a screen down on a phone. On a phone a button shows the form's number and count.
  const quick = choices.slice(0, QUICK + 1);
  const more = choices.slice(QUICK + 1);
  const inMore = more.some((c) => c.key === shown.key);
  return (
    <div>
      {choices.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={`Which form in ${block}`}>
            {quick.map((c) => (
              <Fragment key={c.key}>
                <li>
                  <button
                    type="button"
                    aria-pressed={c.key === shown.key}
                    onClick={() => choose(c.key)}
                    className={choiceVariants({ on: c.key === shown.key })}
                  >
                    {c.key === "all" ? "All forms" : c.key}
                    {c.key !== "all" && BLOCK_FORM_WORDS[c.key] ? (
                      <span className="hidden sm:inline">, {BLOCK_FORM_WORDS[c.key]}</span>
                    ) : null}{" "}
                    <span className="font-mono tabular-nums">{c.mix.total.toLocaleString("en-US")}</span>
                  </button>
                </li>{" "}
              </Fragment>
            ))}
          </ul>{" "}
          {more.length ? (
            <label className="flex w-full min-w-0 items-center gap-2 text-sm font-bold sm:w-auto">
              <span className="shrink-0">More forms</span>{" "}
              <select
                value={inMore ? shown.key : ""}
                onChange={(e) => e.target.value && choose(e.target.value)}
                className={`min-h-11 w-full min-w-0 max-w-full flex-1 border-2 bg-card px-3 text-base font-medium focus-visible:ring-2 focus-visible:ring-primary sm:w-auto sm:flex-none ${inMore ? "border-foreground" : "border-input"}`}
              >
                <option value="">Pick one</option>
                {more.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label} ({c.mix.total.toLocaleString("en-US")})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}{" "}
      <BlockStatusCard
        block={block}
        asOf={asOf}
        mix={shown.mix}
        every={every}
        form={shown.key === "all" ? undefined : shown.key}
        received={received}
        blockCases={blockCases}
        note={parent ? (
          <>
            <p>
              {keepWhole(`An ${shown.key} is sent in with an ${parent}, and USCIS's page doesn't move its receipt on its own. Across every block we've checked, nearly every ${shown.key} receipt still reads "Case Was Received", and none shows an approval. The decision comes on the receipt of the ${parent} filed with it.`)}
            </p>{" "}
            {choices.some((c) => c.key === parent) ? (
              <button type="button" className="link mt-2 min-h-11 text-left font-bold" onClick={() => choose(parent)}>
                {`Show the ${parent} figures`}
              </button>
            ) : null}
          </>
        ) : undefined}
      />{" "}
      <ShareLine className="mt-5" line={lines[shown.key] ?? ""} day={asOf} event="block_line_shared" />
    </div>
  );
}
