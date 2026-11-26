"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BlockMixBar } from "@/components/uscis/BlockMixBar";
import { BLOCK_FORM_EVENT } from "@/components/uscis/BlockStatusChooser";
import { formatInt } from "@/lib/format";
import { BLOCK_MIX_GROUPS, type BlockFormChoice } from "@/lib/uscisSample";

export interface NeighbourBlock {
  block: string;
  every: boolean;
  choices: BlockFormChoice[];
}

/**
 * A block beside the blocks either side of it, each as one status bar in the card's colours, so a reader sees at a
 * glance whether their block is ahead of or behind its neighbours (Nov 26 2026, after a chart of five blocks side by
 * side was passed around a group). It follows the card's form choice; each row opens that block on the same form.
 */
export function BlockNeighbours({ block, rows }: { block: string; rows: NeighbourBlock[] }) {
  const [form, setForm] = useState("all");
  useEffect(() => {
    const m = /(?:^|[#&])form=([A-Za-z0-9-]+)/.exec(window.location.hash);
    if (m?.[1]) setForm(m[1].toUpperCase());
    const on = (e: Event) => setForm(String((e as CustomEvent<string>).detail || "all"));
    window.addEventListener(BLOCK_FORM_EVENT, on);
    return () => window.removeEventListener(BLOCK_FORM_EVENT, on);
  }, []);
  const hash = form === "all" ? "" : `#form=${form}`;
  return (
    <div className="mt-4">
      <ul className="m-0 list-none space-y-4 p-0" aria-label={`${block} and the blocks either side`}>
        {rows.map((r) => {
          const choice = r.choices.find((c) => c.key === form);
          const here = r.block === block;
          return (
            <li key={r.block}>
              {" "}
              <Link
                href={`/uscis-receipt-blocks/${r.block}${hash}`}
                aria-current={here ? "page" : undefined}
                className={`block border-2 p-3 hover:bg-tint ${here ? "border-border bg-tint" : "border-transparent"}`}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-mono text-lg font-bold">
                    {r.block}
                    {here ? <span className="ml-2 font-sans text-base font-bold">This block</span> : null}
                  </span>{" "}
                  <span className="text-base text-muted-foreground">
                    {choice
                      ? `${formatInt(choice.mix.total)} ${form === "all" ? "" : `${form} `}cases, ${r.every ? "every number checked" : "checked so far"}`
                      : `Too few ${form} cases to show`}
                  </span>
                </span>{" "}
                {choice ? (
                  <span className="mt-2 block">
                    <BlockMixBar mix={choice.mix} label={`${form === "all" ? "Every" : form} case in ${r.block}`} />
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>{" "}
      <ul className="mt-4 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-base" aria-label="What the colours mean">
        {BLOCK_MIX_GROUPS.map((g) => (
          <li key={g.key} className="flex items-center gap-2">
            {" "}
            <span aria-hidden="true" className={`inline-block size-4 border-2 border-border ${g.fill}`} />
            {g.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
