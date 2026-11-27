"use client";

import { usePathname } from "next/navigation";

import { SiteBreadcrumbs } from "@/components/layout/SiteBreadcrumbs";
import type { DateSources } from "@/lib/pageDates";
import { isDataPath, sectionForPath } from "@/lib/siteMap";
import { CaseNextStep } from "./CaseNextStep";
import { ReceiptNextStep } from "./ReceiptNextStep";
import { BulletinNextStep, ConsulateNextStep } from "./StepNextBoxes";
import { DataRail } from "./DataRail";

/**
 * Lays a data page out beside the data rail, and stays out of the way
 * everywhere else.
 *
 * In the layout rather than on each page, so a page added tomorrow gets the
 * rail by living at a data URL. `children` is still a server component (it
 * arrives as a prop), and `usePathname` keeps the pages static where reading a
 * header would not.
 *
 * The rail is the original's (round 2, Oct 15 2026: the owner preferred it):
 * a column with a ruled edge, the current page's tab crossing it, groups as
 * headings. Every data page ends with the case box, except the pages that
 * already lead with it.
 */
/** Pages that carry their own case box, so the closing one would repeat it. */
const OWN_LOOKUP: readonly RegExp[] = [
  /^\/perm-case-status/,
  /^\/uscis-case-status/,
  // The bulletin's own pages and the priority date calculator carry the bulletin alert already.
  /^\/visa-bulletin/,
  /^\/tools\/priority-date-calculator/,
  /^\/perm-case-alerts$/,
  /^\/case-search/,
  /^\/perm-employers\/(?!compare$|under-review$|browse$)[^/]+$/,
  /^\/perm-attorneys\/(?!browse$)[^/]+$/,
  /^\/perm-queue\/\d{4}-\d{2}/,
];

type ClosingBox = "perm" | "dol" | "wage" | "receipt" | "bulletin" | "consulate";

/**
 * The closing box for the step a page is about (Nov 26 2026: every data page ended asking for a PERM case number,
 * the USCIS receipt blocks page too). By the page's group in the site map, with a few pages read by their address:
 * a PERM case, a wage request, a DOL case (LCA, H-2A, H-2B), a USCIS receipt past PERM, the visa bulletin's alert on
 * the green card line, the consulates for the steps abroad.
 */
export function closingBoxFor(pathname: string): ClosingBox {
  if (/^\/(uscis-|i485-|i140-|opt-)/.test(pathname)) return "receipt";
  if (/^\/(visa-refusals|visa-wait-times)/.test(pathname)) return "consulate";
  switch (sectionForPath(pathname)?.group) {
    case "I-140":
    case "I-485":
    case "After the green card":
    case "Students and OPT":
      return "receipt";
    case "Wage request":
    case "Wages":
      return "wage";
    case "Green card line":
      return "bulletin";
    case "Consulate":
      return "consulate";
    case "Other visas":
      return "dol";
    default:
      return /^\/(green-card-timelines|tools\/ead-extension|tools\/green-card-fees)/.test(pathname) ? "receipt" : "perm";
  }
}

function ClosingBox({ pathname }: { pathname: string }) {
  const cls = "mt-16 max-w-5xl";
  switch (closingBoxFor(pathname)) {
    case "receipt":
      return <ReceiptNextStep className={cls} />;
    case "bulletin":
      return <BulletinNextStep className={cls} />;
    case "consulate":
      return <ConsulateNextStep className={cls} />;
    case "wage":
      return <CaseNextStep question="Waiting on a wage request?" numberKind="DOL" source="data-page-end" className={cls} />;
    case "dol":
      return <CaseNextStep question="Looking up a DOL case?" numberKind="DOL" source="data-page-end" className={cls} />;
    default:
      return <CaseNextStep question="Waiting on a PERM case?" source="data-page-end" className={cls} />;
  }
}

export function DataShell({ children, sources }: { children: React.ReactNode; sources?: DateSources }) {
  const pathname = usePathname();
  // Off the data pages the trail sits above the page; on them it sits in the
  // content column, so the rail runs from the header down in one piece. Above
  // the rail it left the rail's edge starting a line late, under a toggle
  // floating on its own (Oct 15 2026).
  if (!isDataPath(pathname)) {
    return (
      <>
        <SiteBreadcrumbs sources={sources} />
        {children}
      </>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:flex lg:gap-8">
      {/* `contents` keeps the wrapper out of the flex layout; it exists only so
          the rail can be left off a printed page. */}
      <div className="contents print:hidden">
        <DataRail />
      </div>
      {/* `min-w-0`: a flex item's minimum is its content, so one wide table
          would otherwise push the column past the viewport. Pages set their own
          measure with mx-auto; beside the rail every page starts at the same
          edge, only its width differs. */}
      <div data-shell-column className="min-w-0 pb-16 lg:flex-1 lg:[&>.mx-auto]:ml-0 lg:[&>*>.mx-auto]:ml-0">
        <SiteBreadcrumbs inColumn sources={sources} />
        {children}
        {OWN_LOOKUP.some((re) => re.test(pathname)) ? null : <ClosingBox pathname={pathname} />}
      </div>
    </div>
  );
}
