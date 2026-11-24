import { Fragment } from "react";

import { ARCHIVE_LEAD, archiveItems, foldArchive, type ArchiveList } from "@/lib/policyArchive";
import type { PolicyFeed } from "@/lib/policyFeed";

import { ArchiveYear } from "./ArchiveYear";
import { DocRow } from "./DocRow";

const NOUN: Record<ArchiveList, string> = { agencies: "announcement", decisions: "decision" };

/**
 * A long list (the agencies' own announcements, or the courts' and BALCA's
 * decisions): the newest as full rows, the rest folded by year with each
 * year's count. A year's lines load when a reader opens it (ArchiveYear), and
 * the search box above finds every one of them.
 */
export function OflcArchive({ feed, list, today }: { feed: PolicyFeed; list: ArchiveList; today: string }) {
  const { recent, years } = foldArchive(archiveItems(feed, list), ARCHIVE_LEAD[list]);

  return (
    <>
      <div className="mt-6 border-border bg-card border">
        {recent.map((n) => (
          <DocRow key={n.documentNumber} doc={n} today={today} />
        ))}
      </div>{" "}
      {years.length > 0 ? (
        <div className="mt-6 border-border bg-card border">
          {years.map(({ year, notices }) => (
            <Fragment key={year}>
              <ArchiveYear list={list} year={year} count={notices.length} noun={NOUN[list]} />{" "}
            </Fragment>
          ))}
        </div>
      ) : null}
    </>
  );
}
