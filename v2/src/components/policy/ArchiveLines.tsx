"use client";

import type { ArchiveLine } from "@/lib/policyArchive";

export type { ArchiveLine } from "@/lib/policyArchive";

/**
 * A page of one folded year's lines (ArchiveYear): the document's day and source, and its title linking to where it
 * was published. Each line keeps its `doc-<id>` anchor.
 */
export function ArchiveLines({ lines }: { lines: readonly ArchiveLine[] }) {
  return (
    <ul className="border-t-2 border-border/40 px-5 pb-4 pt-3 text-base leading-relaxed sm:px-6">
      {lines.map(([id, day, url, title]) => (
        <li key={id} id={`doc-${id}`} className="doc-line">
          <span className="doc-day">{day}</span>{" "}
          <a href={url} rel="noopener" target="_blank" className="link doc-a">
            {title}
          </a>{" "}
        </li>
      ))}
    </ul>
  );
}
