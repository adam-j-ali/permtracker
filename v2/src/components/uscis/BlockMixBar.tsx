import { formatInt, formatShareOf } from "@/lib/format";
import type { BlockMix } from "@/lib/uscisSample";

/**
 * A block's cases as one bar, each group a length in the one status code, with a 2px gap between groups inside an ink
 * edge. The block card draws it large with each group's exact figures for its tooltip; the list of blocks draws it
 * small beside the figures it prints. Its name reads every group, so the bar never relies on colour alone.
 */
export function BlockMixBar({ mix, label, size = "lg" }: { mix: BlockMix; label: string; size?: "lg" | "sm" }) {
  const summary = mix.groups.map((g) => `${g.label} ${formatShareOf(g.n, mix.total)}`).join(", ");
  const large = size === "lg";
  return (
    <div
      role="img"
      aria-label={`${label}: ${summary}.`}
      className={`flex w-full gap-[2px] border-2 border-border bg-card p-[2px] ${large ? "h-14 sm:h-16" : "h-5"}`}
    >
      {mix.groups.map((g) => (
        <div
          key={g.key}
          data-tip={
            large
              ? [`${g.label}: ${formatInt(g.n)} cases, ${formatShareOf(g.n, mix.total)}`, ...(g.parts.length > 1 ? g.parts.map(([w, n]) => `${w} ${formatInt(n)}`) : [])].join("\n")
              : undefined
          }
          className={`flex min-w-[3px] items-center overflow-hidden ${g.fill}`}
          style={{ flex: `${g.n} 1 0px` }}
        >
          {large && g.share >= 0.1 && g.key !== "other" ? (
            <span className="whitespace-nowrap px-2 font-mono text-sm font-bold text-black">{formatShareOf(g.n, mix.total)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
