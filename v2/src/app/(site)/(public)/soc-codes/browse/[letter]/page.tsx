/**
 * One letter's job titles, every one a crawlable link to its page, paged for the screen with every name still in
 * the HTML (ListPages). 27 letters known at build, so `dynamicParams = false` makes any other a real 404. A letter
 * no title begins with renders a short note, carries a noindex and is left out of the sitemap.
 */

import type { Metadata } from "next";

import { TitleLetterBody, titleLetterMetadata } from "@/components/soc/TitleBrowse";
import { BROWSE_BUCKETS } from "@/lib/entityBrowse";

// The titles move with the quarterly loads and O*NET's monthly check, as /soc-codes does.
export const revalidate = 604800;
export const dynamicParams = false;

export function generateStaticParams() {
  return BROWSE_BUCKETS.map((letter) => ({ letter }));
}

export async function generateMetadata({ params }: { params: Promise<{ letter: string }> }): Promise<Metadata> {
  const { letter } = await params;
  return titleLetterMetadata(letter);
}

export default async function SocTitlesLetterPage({ params }: { params: Promise<{ letter: string }> }) {
  const { letter } = await params;
  return <TitleLetterBody letter={letter} />;
}
