import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";

import { FinePrint } from "@/components/data/FinePrint";
import { IndexHeader } from "@/components/data/IndexHeader";
import { PageBasics, type BasicsEntry } from "@/components/data/PageBasics";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { ScrollBox } from "@/components/ui/scroll-box";
import { UscisAccountReader } from "@/components/tools/UscisAccountReader";
import { SITE_URL } from "@/lib/constants/site";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";
import { getFAQPageSchema } from "@/lib/structuredData";
import { ACCOUNT_CODE_INFO, EVIDENCE_WORDS } from "@/lib/uscis/accountCodes";

/**
 * Paste what your own USCIS online account shows: each update by date, what its code is known to mean, and a way to
 * add them to your green card timeline. The reading happens in the browser (src/components/tools/UscisAccountReader.tsx,
 * src/lib/uscis/accountReader.ts); this page is static and never sees the paste.
 *
 * USCIS publishes no meanings for these codes, so every reading says where it comes from
 * (src/lib/uscis/accountCodes.ts), and the page says plainly that a code is never a decision.
 */

const TITLE = "Read Your USCIS Account Updates and Codes";
const DESCRIPTION =
  "Paste what your USCIS online account shows to see each update by date and what its code, like FTA0 or IAF, is known to mean. It stays in your browser.";

export const metadata: Metadata = withSocialCard(
  {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/uscis-account-reader" },
    openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: "/uscis-account-reader" },
  },
  "uscis-account-reader",
);

/** The questions, in words a search engine and a screen reader both read, and the FAQ schema from the same text. */
const FAQS: { q: string; a: string }[] = [
  {
    q: "Does this page see my USCIS account?",
    a: "No. It never signs in to USCIS and never asks for your login. It reads only what you paste, in this browser, and sends nothing anywhere. Close the page and it's gone.",
  },
  {
    q: "What does FTA0 mean in my USCIS account?",
    a: "USCIS's own code list from 2008 reads FTA0 as \"DATABASE CHECKS RECEIVED\". Filers often see it within hours of biometrics and again later. It doesn't say which check ran or whether the result was clear, and a third FTA0 isn't a sign that approval is close.",
  },
  {
    q: "Is a code in my account a decision on my case?",
    a: "No. USCIS decides a case in a notice, mailed and shown in your account. On July 22 and 23, 2026 a USCIS fault wrote H008, which filers read as an approval, on cases that weren't approved.",
  },
  {
    q: "Where do these readings come from?",
    a: "USCIS publishes no meanings for these codes. Where a code is in USCIS's CLAIMS 3 user manual or the Department of Homeland Security's NIEM data standard, we quote that wording. Otherwise we say what filers consistently report, or that there's no settled reading.",
  },
  {
    q: "What happens when I add these updates to my timeline?",
    a: "They fill the timeline form on this page: the day, the form and the code of each. Nothing is sent until you press Save, a receipt number is never sent, and each timeline is checked before it shows. Once five timelines report a code, the green card timelines page shows how many saw it.",
  },
];

const ENTRIES: BasicsEntry[] = FAQS.map((f) => ({ q: f.q, a: f.a }));

const tool = {
  "@context": "https://schema.org",
  "@type": "WebApplication" as const,
  name: "USCIS account reader",
  url: `${SITE_URL}/uscis-account-reader`,
  description: DESCRIPTION,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  offers: { "@type": "Offer" as const, price: "0", priceCurrency: "USD" },
};

export default function UscisAccountReaderPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={tool} />
      <JsonLdScript schema={getFAQPageSchema(FAQS.map((f) => ({ question: f.q, answer: f.a })))} />
      <IndexHeader
        title="Read your USCIS account updates"
        lede="Paste what your online account shows. See each update by date and what its code is known to mean, then add them to your timeline if you want. It all stays in your browser."
      />{" "}

      <section className="mt-8 max-w-4xl" aria-label="The reader">
        <UscisAccountReader />
      </section>{" "}

      <FinePrint summary="Where to copy it from" className="mt-6 max-w-3xl">
        <p>
          Sign in to your USCIS account on a computer and open your case. If it lists its updates, copy that list and
          paste it here. The account page itself doesn&apos;t print the codes, so filers who want them copy the case data
          their own browser received: open the browser&apos;s developer tools (F12 on most computers), choose Network,
          reload the case page, pick the request named with your receipt number, and copy its response.
        </p>{" "}
        <p className="mt-3">
          That&apos;s your own data, read by your own browser. Nothing here touches USCIS, and nothing you paste leaves
          this page.
        </p>
      </FinePrint>{" "}

      <section className="mt-12" aria-labelledby="codes-h">
        <h2 id="codes-h" className="font-heading text-2xl font-bold">
          What each code is known to mean
        </h2>{" "}
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-soft">
          USCIS publishes no meanings, so each reading says where it comes from. A code is never a decision: USCIS decides
          a case in a notice.
        </p>{" "}
        <ScrollBox label="USCIS account codes and what each is known to mean" className="mt-5 max-w-4xl">
          <table className="w-full min-w-[36rem] border-collapse text-left text-base">
            <caption className="sr-only">USCIS account codes, where each reading comes from, and what filers report{" "}</caption>
            <thead>
              <tr className="border-b-2 border-border text-sm text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-bold">Code{" "}</th>
                <th scope="col" className="py-2 font-bold">What&apos;s known{" "}</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNT_CODE_INFO.map((c) => (
                <Fragment key={c.code}>
                  <tr className="border-b border-border/60 align-top">
                    <th scope="row" className="py-3 pr-4 font-mono font-bold">
                      {c.code}{" "}
                    </th>
                    <td className="py-3 text-sm leading-relaxed">
                      <span className="font-semibold">{EVIDENCE_WORDS[c.evidence]}</span>{" "}
                      {c.government ? <span>{`"${c.government}" (${c.source}). `}</span> : null}
                      <span>{c.filers} </span>
                      {c.caution ? <span className="mt-1 block text-muted-foreground">{c.caution} </span> : null}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </ScrollBox>{" "}
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          The fuller story of each code, with the sources:{" "}
          <Link href="/guides/uscis-silent-updates" className="link">
            USCIS silent updates and account codes
          </Link>
          .
        </p>
      </section>{" "}

      <section className="mt-12" aria-labelledby="next-h">
        <h2 id="next-h" className="font-heading text-2xl font-bold">
          Where to look next
        </h2>{" "}
        <ul className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2 [&>*]:min-w-0">
          {[
            { href: "/green-card-timelines", label: "Green card timelines people shared" },
            { href: "/i485-by-field-office", label: "I-485s at each USCIS office" },
            { href: "/uscis-case-status", label: "Check a USCIS case by receipt number" },
            { href: "/guides/uscis-silent-updates", label: "What silent updates are, and aren't" },
          ].map((l) => (
            <Fragment key={l.href}>
              <li>
                <Link href={l.href} className="link inline-flex min-h-11 items-center">
                  {l.label}
                </Link>
              </li>{" "}
            </Fragment>
          ))}
        </ul>
      </section>{" "}

      <PageBasics page="uscis-account-reader" entries={ENTRIES} />
    </div>
  );
}
