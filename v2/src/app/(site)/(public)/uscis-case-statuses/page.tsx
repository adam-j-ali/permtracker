import type { Metadata } from "next";
import Link from "next/link";

import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";
import { SITE_URL } from "@/lib/constants/site";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";
import { USCIS_STATUS_GROUPS } from "@/lib/uscis/statusGroups";

/**
 * What each USCIS case status means (Batch 8, Nov 25 2026): the statuses USCIS's case status page shows, in ten
 * kinds, each with what it means and what to do next, and USCIS's own titles under it. The receipt alert emails and
 * the lookup point here. The groups are the ones our USCIS sample reads statuses by (src/lib/uscis/statusGroups.ts).
 */

const PATH = "/uscis-case-statuses";
const TITLE = "What each USCIS case status means";
const DESCRIPTION =
  "USCIS's case statuses in ten kinds, from received to approved, denied or rejected: what each means and what to do next, with USCIS's own wording.";

export const metadata: Metadata = withSocialCard(
  {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: PATH },
    openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: PATH },
  },
  "uscis-case-statuses",
);

const anchor = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function UscisCaseStatusesPage() {
  const base = SITE_URL;
  const termSet = {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet" as const,
    "@id": `${base}${PATH}`,
    name: "USCIS case status vocabulary",
    description: DESCRIPTION,
    hasDefinedTerm: USCIS_STATUS_GROUPS.flatMap((g) =>
      g.titles.map((t) => ({
        "@type": "DefinedTerm" as const,
        "@id": `${base}${PATH}#${anchor(t)}`,
        name: t,
        description: g.means,
        inDefinedTermSet: `${base}${PATH}`,
      })),
    ),
  };
  const total = USCIS_STATUS_GROUPS.reduce((n, g) => n + g.titles.length, 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={termSet} />
      <header className="pt-10 sm:pt-12">
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">{TITLE}</h1>{" "}
        <p className="mt-4 max-w-2xl text-lg text-soft">
          <KeepWhole>
            {`USCIS's case status page shows one of about ${Math.round(total / 10) * 10} statuses. They come down to ten kinds. Find yours below, see what it means and what, if anything, to do next.`}
          </KeepWhole>
        </p>{" "}
        <p className="mt-4 text-base">
          <Link href="/uscis-case-status" className="link font-bold">
            Look up a receipt&apos;s status
          </Link>{" "}
          <span className="text-soft">and get an email when it changes.</span>
        </p>
      </header>{" "}
      <nav aria-label="The ten kinds" className="mt-8">
        <ul className="flex flex-wrap gap-2">
          {USCIS_STATUS_GROUPS.map((g) => (
            <li key={g.key}>
              <a href={`#${g.key}`} className="inline-flex min-h-11 items-center border-2 border-border bg-card px-3 text-base font-bold">
                {keepWhole(g.name)}
              </a>{" "}
            </li>
          ))}
        </ul>
      </nav>{" "}
      <div className="mt-10 grid grid-cols-1 gap-8">
        {USCIS_STATUS_GROUPS.map((g) => (
          <section key={g.key} id={g.key} aria-labelledby={`${g.key}-title`} className="scroll-mt-24 border-t-2 border-border pt-6">
            <h2 id={`${g.key}-title`} className="font-heading text-2xl font-bold">
              {keepWhole(g.name)}
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base">{keepWhole(g.means)}</p>{" "}
            <p className="mt-2 max-w-2xl text-base text-soft">
              <b className="text-foreground">What to do:</b> {keepWhole(g.next)}
            </p>{" "}
            <details className="mt-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-base font-bold">
                {`USCIS's ${g.titles.length === 1 ? "wording" : `${g.titles.length} wordings`}`}
              </summary>
              <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 [&>*]:min-w-0">
                {g.titles.map((t) => (
                  <li key={t} id={anchor(t)} className="text-base">
                    {keepWhole(t)}{" "}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        ))}
      </div>
    </div>
  );
}
