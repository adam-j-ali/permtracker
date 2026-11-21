/**
 * The job title A to Z: how many title pages sit behind each letter, every letter one link away, so every title
 * page is two links from /soc-codes (lib/socTitleBrowse.ts says why). A static `browse` segment beside
 * `[title]`: Next resolves the static one first, and no title's slug is "browse".
 */

import type { Metadata } from "next";

import { TitleIndexBody, titleIndexMetadata } from "@/components/soc/TitleBrowse";

export const metadata: Metadata = {
  ...titleIndexMetadata(),
  // Spelled out here because scripts/audit_page_registration.py reads the canonical from the page file.
  alternates: { canonical: "/soc-codes/browse" },
};

// The titles move with the quarterly loads and O*NET's monthly check, as /soc-codes does.
export const revalidate = 604800;

export default async function SocTitlesBrowsePage() {
  return <TitleIndexBody />;
}
