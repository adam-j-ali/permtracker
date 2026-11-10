import Link from "next/link";
import { Fragment } from "react";
import { ArrowRightIcon } from "@phosphor-icons/react/ssr";

import { choiceVariants } from "@/components/ui/choice";
import { cn } from "@/lib/utils";

/**
 * The steps after PERM, one tap from the homepage's case box. Most people who land here are waiting on a PERM case,
 * and the box above answers that. The next largest group is past it, waiting on the I-140, the visa bulletin or the
 * I-485, and their answer sat a few screens down. Links, each with an arrow: every one opens that step's own page.
 *
 * A NAME IS WRITTEN ONCE. A phone has room for three short names and a wide screen for the full ones, so the full
 * name is the text and a phone hides the words around its core. Two copies, one hidden at each width, reach a
 * search engine as glued words.
 */
export const HERO_STEPS = [
  { href: "/uscis-processing-times/i-140", before: "", core: "I-140", after: " times" },
  { href: "/visa-bulletin", before: "Visa ", core: "bulletin", after: "" },
  { href: "/uscis-processing-times/i-485", before: "", core: "I-485", after: " times" },
] as const;

export function HeroSteps({ className }: { className?: string }) {
  return (
    <nav aria-label="The steps after PERM" className={className}>
      <p className="text-sm font-semibold text-soft">Past PERM already?</p>{" "}
      {/* Three across on a phone, each a full-width target: wrapped, the third sat alone on a second line. */}
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap [&>*]:min-w-0">
        {HERO_STEPS.map((s) => (
          <Fragment key={s.href}>
            <li>
              <Link href={s.href} className={cn(choiceVariants({ on: false }), "w-full gap-2 px-2 font-semibold sm:w-auto sm:px-4")}>
                {/* One child for the name, so the chip's own gap never opens it up. */}
                <span>
                  {s.before ? <span className="hidden sm:inline">{s.before}</span> : null}
                  {/* A core that opens its name on a phone ("bulletin") takes a capital there; ::first-letter needs a block. */}
                  <span className={s.before ? "inline-block first-letter:uppercase sm:inline sm:first-letter:normal-case" : undefined}>{s.core}</span>
                  {s.after ? <span className="hidden sm:inline">{s.after}</span> : null}
                </span>
                <ArrowRightIcon aria-hidden="true" weight="bold" className="size-4 shrink-0" />
              </Link>
            </li>{" "}
          </Fragment>
        ))}
      </ul>
    </nav>
  );
}
