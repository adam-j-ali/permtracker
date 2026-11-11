import { CaseLookupForm } from "@/components/tools/CaseLookupForm";

/**
 * The case box at the top of a guide or a post, under its header.
 *
 * WHY HERE. Most people reading a guide are waiting on a case of their own, and until Nov 11 2026 the only case
 * box on an article sat after its last paragraph, where almost nobody reached it. Every other page opens with its
 * search, and an article is no exception: the box is one line under the header on a wide screen (the first
 * screen), and on a phone it's the first thing after the header's picture, before the article's first paragraph.
 *
 * The box at the article's end (ContentCTA) stays: it's the next step for someone who read to the bottom.
 */
export function ArticleCaseBox() {
  return (
    <aside aria-label="Check a case" className="border-b-2 border-border bg-background print:hidden">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-6">
        <p className="text-base font-semibold lg:shrink-0">Waiting on a PERM case?</p>{" "}
        <CaseLookupForm className="w-full lg:max-w-2xl" compact label="Case number or employer" names help={null} source="article-top" flatFinder />
      </div>
    </aside>
  );
}
