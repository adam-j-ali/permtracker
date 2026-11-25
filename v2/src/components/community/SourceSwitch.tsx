"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ChoiceRow } from "@/components/ui/choice-row";
import { analytics } from "@/lib/analytics";
import type { SourceKind } from "@/lib/sourceKind";
import { SOURCE_VIEWS, sourceViewFrom, withSourceView, type SourceViewId } from "@/lib/sourceView";

/**
 * The sources switch (D3, Nov 25 2026): one row of choices over a step's figures that shows every kind or one: the
 * agency's, our own count of its records, or people's reports. The figures are all in the server's HTML; a view only
 * hides the others, through the `data-source-kind` each card carries (Figure) and one rule in globals.css keyed on
 * `data-source-view`. Reading the view from the address happens after the page loads, so the 29 static step pages
 * stay static. The choices are buttons that say which is picked (aria-pressed), and a status line says what shows.
 */

const SAYS: Record<SourceViewId, string> = {
  all: "Showing every figure.",
  agency: "Showing the agency's figures.",
  ours: "Showing our own count.",
  people: "Showing people's reports.",
};

const NOTHING: Record<SourceKind, string> = {
  official: "This box has no figure the agency publishes for this step.",
  measured: "We don't count this step ourselves yet.",
  community: "No one has reported this step's dates yet.",
};

export function SourceSwitch({ kinds, children }: { kinds: readonly SourceKind[]; children: ReactNode }) {
  const [view, setView] = useState<SourceViewId>("all");
  const [said, setSaid] = useState("");

  useEffect(() => {
    const asked = sourceViewFrom(window.location.search);
    if (asked !== "all") setView(asked);
  }, []);

  if (new Set(kinds).size < 2) return <>{children}</>;

  const pick = (next: SourceViewId) => {
    setView(next);
    setSaid(SAYS[next]);
    const { pathname, search, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${withSourceView(search, next)}${hash}`);
    analytics.capture("source_switch", { view: next, path: pathname });
  };
  const kind = SOURCE_VIEWS.find((v) => v.id === view)?.kind ?? null;

  return (
    <div>
      <ChoiceRow
        label="Show figures from"
        hideLabel
        options={SOURCE_VIEWS.map((v) => ({ value: v.id, label: v.label }))}
        value={view}
        onChange={pick}
      />{" "}
      <p role="status" className="sr-only">
        {said}
      </p>{" "}
      {kind && !kinds.includes(kind) ? <p className="mt-4 text-base text-muted-foreground">{NOTHING[kind]}</p> : null}{" "}
      <div data-source-view={view} className="mt-5">
        {children}
      </div>
    </div>
  );
}
