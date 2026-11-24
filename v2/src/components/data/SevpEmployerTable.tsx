import { Fragment } from "react";

import { SevpRowsTable, type SevpTableRow } from "@/components/data/SevpRowsTable";
import type { SevpList } from "@/lib/db/sevpEmployers";

/**
 * One of ICE's top-200 lists as a ranked table with a bar per employer, drawn
 * to the list's leader, a page at a time. Names are ICE's own ("Amazon",
 * "University of California"), not legal entities, so each links a search
 * rather than a claimed match to one employer's record.
 */

/** Only what a row draws: the page's data carries these once per row. */
const slim = (rows: SevpList["rows"]): SevpTableRow[] =>
  rows.map(({ rank, employer, total, opt, stemOpt }) => ({ rank, employer, total, opt, stemOpt }));

export function SevpEmployerTable({ list }: { list: SevpList }) {
  const opt = list.list === "opt";
  return <SevpRowsTable opt={opt} rows={slim(list.rows)} label={`ICE's top employers for ${opt ? "OPT and STEM OPT" : "CPT"}, ${list.year}`} />;
}

/** ICE's own ordering slips, said where the table is. */
export function AsPrinted({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      As ICE printed it:{" "}
      {notes.map((n, i) => (
        <Fragment key={n}>
          {i > 0 ? "; " : ""}
          {n}
        </Fragment>
      ))}
      .
    </p>
  );
}
