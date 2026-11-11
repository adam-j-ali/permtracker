import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataProvenance } from "@/components/data/DataProvenance";
import { DailyUpdateView } from "@/components/updates/DailyUpdateView";
import { loadDailyUpdate } from "@/components/updates/loadDailyUpdate";
import { longDate } from "@convex/lib/months";

/**
 * One DOL day's PERM decisions (/perm-updates/2026-11-10): the address a person pastes into a chat.
 *
 * One of these exists for every day since our own record began, each a short list, so they stay out of the
 * sitemap and carry noindex: /perm-updates is the page worth finding, and it links here.
 *
 * A day DOL is still working moves with each check, and a generated page isn't one the check can expire by name,
 * so each holds for half an hour.
 */
export const revalidate = 1800;

export async function generateStaticParams(): Promise<{ day: string }[]> {
  return [];
}

type Params = { day: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { day } = await params;
  const label = longDate(day);
  if (!label) notFound();
  return {
    title: `PERM Decisions on ${label}`,
    description: `The PERM cases the Department of Labor certified, denied and saw withdrawn on ${label}, the filing dates they came from, and every case it moved.`,
    alternates: { canonical: `/perm-updates/${day}` },
    robots: { index: false, follow: true },
  };
}

export default async function PermUpdatesDayPage({ params }: { params: Promise<Params> }) {
  const { day } = await params;
  const load = await loadDailyUpdate(day);
  if (!load) notFound();
  if (load.kind === "outside") {
    return (
      <div className="mx-auto max-w-[1200px] px-4 pt-6 pb-12 sm:px-6 sm:pb-16">
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">PERM decisions, {longDate(day)}</h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Our own day-by-day record of DOL&apos;s case status {load.since ? `starts on ${longDate(load.since)}` : "doesn't reach this day"}, so this page has
          nothing for that date. DOL&apos;s published files cover earlier decisions.
        </p>{" "}
        <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
          <Link href={`/perm-decision-activity?from=${day}&to=${day}`} className="link inline-flex min-h-11 items-center">
            That day in DOL&apos;s published files
          </Link>{" "}
          <Link href="/perm-updates" className="link inline-flex min-h-11 items-center">
            The newest day
          </Link>
        </p>
      </div>
    );
  }
  return (
    <>
      <DailyUpdateView {...load.props} />
      <div className="mx-auto max-w-[1200px] px-4 pb-12 sm:px-6">
        <DataProvenance datasets={["perm-case-status", "pwd-status"]} />
      </div>
    </>
  );
}
