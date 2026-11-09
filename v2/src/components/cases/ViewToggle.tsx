"use client";

/**
 * ViewToggle
 *
 * Two buttons that switch the case list between cards and rows. The chosen
 * one is lime, like every picked option; each says its name to a screen
 * reader and on hover.
 *
 * @module components/cases/ViewToggle
 */

import { ListIcon, SquaresFourIcon } from "@phosphor-icons/react/ssr";
import { choiceVariants } from "@/components/ui/choice";
import { cn } from "@/lib/utils";

export type ViewMode = "card" | "list";

export interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
  className?: string;
}

const VIEWS = [
  { id: "card", label: "Card view", Icon: SquaresFourIcon },
  { id: "list", label: "List view", Icon: ListIcon },
] as const;

export function ViewToggle({ view, onChange, className }: ViewToggleProps) {
  return (
    // Two toggle buttons, each a tab stop: a radio group would promise arrow keys it doesn't have.
    <div role="group" aria-label="View mode" className={cn("inline-flex gap-1", className)}>
      {VIEWS.map(({ id, label, Icon }) => {
        const on = view === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            aria-label={label}
            title={label}
            onClick={() => {
              if (!on) onChange(id);
            }}
            className={choiceVariants({ on, className: "size-11 px-0" })}
          >
            <Icon className="size-5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
