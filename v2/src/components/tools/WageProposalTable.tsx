import { ScrollBox } from "@/components/ui/scroll-box";
import { LEVEL_PERCENTILES, WAGE_PROPOSAL, proposedFloors, type LevelWage } from "@/lib/wageProposal";
import { longDate } from "@convex/lib/months";

/**
 * What DOL's proposed wage rule would do to the four levels for the job and area on screen.
 *
 * WHO IT'S FOR. Someone with an offer or a pending case who has heard "the wage rule" and wants one answer: what
 * would the floor for my job be. The table puts today's figure beside what today's figures say about the
 * proposal, in dollars, and says "about" and "above" where that's all that can be said (src/lib/wageProposal.ts).
 *
 * IT NEVER SAYS THE RULE IS IN FORCE. The levels that apply are today's. `stage` is the rule's own record
 * (rule_pipeline, read on the server): while the final rule is unpublished the block says its numbers aren't
 * public; once one is published it says so and that these are still the proposal's figures, so a page nobody has
 * updated yet can't pass the proposal off as the final rule.
 */

export interface WageRuleStage {
  /** The day OIRA received the final rule for review, "YYYY-MM-DD". */
  sentToReview: string | null;
  /** The day a final rule was published in the Federal Register. */
  finalPublished: string | null;
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** "52nd", "34th", "88th". */
const nth = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
};

export function WageProposalTable({ levels, stage }: { levels: readonly LevelWage[]; stage: WageRuleStage | null }) {
  const floors = proposedFloors(levels);
  if (!floors) return null;
  const proposed = longDate(WAGE_PROPOSAL.proposedOn) ?? WAGE_PROPOSAL.proposedOn;
  return (
    <section aria-labelledby="wage-proposal" className="mt-10 border-t-2 border-border pt-6">
      <h3 id="wage-proposal" className="font-heading text-xl font-bold">
        If DOL&apos;s proposed wage rule takes effect
      </h3>{" "}
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-soft">
        DOL proposed moving all four levels up the pay scale on {proposed}.{" "}
        {stage?.finalPublished ? (
          <>
            It published a final rule on {longDate(stage.finalPublished) ?? stage.finalPublished}. The figures below are
            still the proposal&apos;s, read against today&apos;s levels.
          </>
        ) : stage?.sentToReview ? (
          <>
            It sent the final rule to the White House for review on {longDate(stage.sentToReview) ?? stage.sentToReview}, and
            the final numbers aren&apos;t public yet. This is the proposal, read against today&apos;s levels.
          </>
        ) : (
          <>No final rule has been published. This is the proposal, read against today&apos;s levels.</>
        )}
      </p>{" "}
      <ScrollBox label="Each wage level today and under the proposal" className="mt-4">
        <table className="w-full border-collapse sm:min-w-[520px] border-t-2 border-[var(--object-border)] text-left text-base">
          <caption className="sr-only">Each wage level for this job and area: today&apos;s figure, and what the proposal would make it</caption>
          <thead className="bg-sage">
            <tr>
              <th scope="col" className="px-2 py-3 sm:px-3 text-sm font-bold">Level{" "}</th>
              <th scope="col" className="px-2 py-3 sm:px-3 text-sm font-bold">Today{" "}</th>
              <th scope="col" className="px-2 py-3 sm:px-3 text-sm font-bold">Under the proposal{" "}</th>
            </tr>
          </thead>
          <tbody>
            {floors.map((f) => (
              <tr key={f.level} className="border-t-2 border-border/40 align-top">
                <th scope="row" className="px-2 py-3 sm:px-3 text-left">
                  <span className="block font-heading font-bold">{`Level ${f.level} `}</span>{" "}
                  <span className="block text-sm font-normal text-soft">
                    {`${nth(LEVEL_PERCENTILES[f.level].today)} to ${nth(LEVEL_PERCENTILES[f.level].proposed)} percentile `}
                  </span>
                </th>
                <td className="px-2 py-3 sm:px-3 tabular-nums">{`${usd(f.today.yearly)} `}</td>
                <td className="px-2 py-3 sm:px-3">
                  {f.proposed.kind === "unknown" ? (
                    <span>Higher than today. DOL publishes no figure that high yet. </span>
                  ) : (
                    <>
                      <span className="font-semibold tabular-nums">{`${f.proposed.kind === "about" ? "About" : "Above"} ${usd(f.proposed.yearly)} `}</span>{" "}
                      <span className="block text-sm text-soft">
                        {`${f.risePct}% ${f.proposed.kind === "about" ? "more" : "more at least"}: today's Level ${f.proposed.like} `}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>{" "}
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-soft">
        Why &quot;about&quot;: DOL measures Levels I and IV from its wage survey and sets II and III evenly between them, so
        today&apos;s Level II is near the 34th percentile, never exactly on it. The levels in force are today&apos;s until a
        final rule takes effect. Source: the proposed rule,{" "}
        <a href={WAGE_PROPOSAL.url} target="_blank" rel="noopener noreferrer" className="link">
          {WAGE_PROPOSAL.citation}
        </a>
        .
      </p>
    </section>
  );
}
