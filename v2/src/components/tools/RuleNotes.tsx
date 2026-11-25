import { CaretRightIcon } from "@phosphor-icons/react/ssr";

import { keepWhole } from "@/components/ui/keep-whole";

/**
 * The regulations behind a calculator's answer, folded under one line. The
 * answer is the picture; the citations are there for whoever wants to check it. Each note goes through keepWhole, so a
 * form name in it (I-140, I-907) never splits at its hyphen on a phone, though the sweep never opens the fold.
 */
export function RuleNotes({ items, summary = "The rules behind it" }: { items: string[]; summary?: string }) {
  if (items.length === 0) return null;
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
        <CaretRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {summary}{" "}
      </summary>
      <ul className="mt-1 space-y-1 border-l-2 border-border pl-4 text-sm text-muted-foreground">
        {items.map((c) => (
          <li key={c}>{keepWhole(c)}{" "}</li>
        ))}
      </ul>
    </details>
  );
}
