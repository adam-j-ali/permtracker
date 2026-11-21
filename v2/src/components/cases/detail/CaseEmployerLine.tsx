"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { LookupEmployer } from "@/lib/api/employerLookup";
import { formatInt } from "@/lib/format";

/**
 * The case's employer on PERM Tracker's public pages: its name links to its employer page, with one line on what DOL's
 * files show for it. It asks the same lookup the browser extension uses (`/v1/lookup/employer`), and only an exact
 * match of the name is linked, since a near match can be another company. Nothing shows when there's no exact match
 * or the lookup can't be read: the case page stands without it.
 */
export function useEmployerPage(name: string | null | undefined): LookupEmployer | null {
  const [hit, setHit] = useState<LookupEmployer | null>(null);
  useEffect(() => {
    const q = name?.trim();
    if (!q || q.length < 2) {
      setHit(null);
      return;
    }
    let live = true;
    fetch(`/v1/lookup/employer?name=${encodeURIComponent(q.slice(0, 120))}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { match?: string; employer?: LookupEmployer | null } } | null) => {
        if (live) setHit(j?.data?.match === "exact" && j.data.employer ? j.data.employer : null);
      })
      .catch(() => {
        if (live) setHit(null);
      });
    return () => {
      live = false;
    };
  }, [name]);
  return hit;
}

/** What the record shows, as the parts of one sentence. */
export function employerLineParts(e: LookupEmployer): string[] {
  const p = e.perm;
  const parts: string[] = [];
  if (p.published > 0) {
    parts.push(
      `${formatInt(p.published)} PERM case${p.published === 1 ? "" : "s"} DOL decided${p.certifiedShare !== null ? `, ${Math.round(p.certifiedShare * 100)}% of them certified` : ""}`,
    );
  }
  if (p.pending) parts.push(`${formatInt(p.pending)} still waiting at DOL`);
  if (e.wageRequests) parts.push(`${formatInt(e.wageRequests)} wage request${e.wageRequests === 1 ? "" : "s"}`);
  if (e.h1bLcas) parts.push(`${formatInt(e.h1bLcas)} H-1B LCA${e.h1bLcas === 1 ? "" : "s"}`);
  return parts;
}

export function CaseEmployerLine({ employer }: { employer: LookupEmployer | null }) {
  if (!employer) return null;
  const parts = employerLineParts(employer);
  return (
    <p className="mt-1 text-base text-muted-foreground [overflow-wrap:anywhere]">
      <Link href={`/perm-employers/${employer.slug}`} className="link font-semibold">
        {`${employer.name} on PERM Tracker`}
      </Link>
      {parts.length ? `. ${parts.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(". ")}.` : "."}
    </p>
  );
}
