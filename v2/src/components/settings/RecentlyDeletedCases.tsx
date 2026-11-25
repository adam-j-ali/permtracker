"use client";

/**
 * RecentlyDeletedCases
 *
 * Settings, under Support: the cases this account deleted in the last DELETED_CASE_DAYS, newest first, each with a
 * Restore button (convex/caseRestore.ts). A restored case comes back as a new case with its dates, notes and stage.
 * Its documents and its recruitment log were erased when it was deleted, and the change log never keeps the
 * employer's FEIN, so the section says those don't come back. The Privacy Policy says the same, under "Case Data"
 * and in section 14.
 */

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DELETED_CASE_DAYS } from "@convex/lib/deletedCases";
import { Button } from "@/components/ui/button";
import { Pagination, usePagedRows } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthContext } from "@/lib/contexts/AuthContext";
import { handleOperationError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { SettingsCard, SettingsCardSkeleton } from "./SettingsCard";
import { caseSubtitle, caseTitle } from "@convex/lib/caseLabel";

/** A short page on a phone, a few more on a wide screen. */
const PAGE_SIZES = { wide: 10, narrow: 5, options: [5, 10, 25, 50] } as const;

const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Deleted = {
  auditLogId: Id<"auditLogs">;
  employerName: string;
  positionTitle: string;
  beneficiaryIdentifier: string | null;
  deletedAt: number;
  restoreBy: number;
};

/** The name a person knows the case by: the employer and the job. */
const caseName = (c: Deleted) => [c.employerName, c.positionTitle].filter(Boolean).join(", ") || "This case";

export default function RecentlyDeletedCases() {
  const { isSigningOut } = useAuthContext();
  const router = useRouter();
  // One reading of the clock when the section opens: the list is the last 30 days from then.
  const [now] = useState(() => Date.now());
  const listed = useQuery(api.caseRestore.listRecentlyDeleted, isSigningOut ? "skip" : { now });
  const restore = useMutation(api.caseRestore.restoreDeleted);
  const [restoring, setRestoring] = useState<Id<"auditLogs"> | null>(null);
  const top = useRef<HTMLUListElement>(null);
  const cases: Deleted[] = listed?.cases ?? [];
  const paged = usePagedRows(cases, PAGE_SIZES);

  const handleRestore = async (c: Deleted) => {
    setRestoring(c.auditLogId);
    try {
      const caseId = await restore({ auditLogId: c.auditLogId });
      toast.success("Case restored", {
        description: `${caseName(c)} is back in your cases.`,
        action: { label: "Open case", onClick: () => router.push(`/cases/${caseId}`) },
      });
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === "string") toast.error(error.data);
      else handleOperationError(error, { userMessage: "Couldn’t restore the case. Try again." });
    } finally {
      setRestoring(null);
    }
  };

  if (listed === undefined) {
    return (
      <SettingsCardSkeleton>
        <Skeleton variant="line" className="h-6 w-1/3" />
        <Skeleton variant="line" className="h-4 w-2/3" />
      </SettingsCardSkeleton>
    );
  }

  return (
    <SettingsCard
      title="Recently deleted"
      description={`Cases you deleted in the last ${DELETED_CASE_DAYS} days. Restore one to put it back in your cases.`}
    >
      {cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You haven’t deleted a case in the last {DELETED_CASE_DAYS} days. A case you delete stays here for{" "}
          {DELETED_CASE_DAYS} days, so you can restore it.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A restored case comes back with its dates, notes and stage. Its documents, its recruitment log and an
            employer’s FEIN were erased when it was deleted, so they can’t be restored.
          </p>{" "}
          <ul ref={top} className="scroll-mt-24 divide-y divide-border border-y border-border">
            {paged.shown.map((c) => (
              <li
                key={c.auditLogId}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-medium text-foreground">{caseTitle(c, "No employer name")}</p>{" "}
                  {caseSubtitle(c) ? (
                    <p className="break-words text-sm text-muted-foreground">
                      {caseSubtitle(c)}
                    </p>
                  ) : null}{" "}
                  <p className="text-sm text-muted-foreground">
                    {`Deleted ${day(c.deletedAt)}. You can restore it until ${day(c.restoreBy)}.`}
                  </p>
                </div>{" "}
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => handleRestore(c)}
                  disabled={restoring !== null}
                  loading={restoring === c.auditLogId}
                  loadingText="Restoring..."
                  aria-label={`Restore ${caseName(c)}`}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>{" "}
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onPage={paged.setPage}
            total={cases.length}
            perPage={paged.perPage}
            noun="deleted cases"
            label="Pages of deleted cases"
            scrollTo={top}
            per={paged.per}
          />{" "}
          {listed.more ? (
            <p className="text-sm text-muted-foreground">
              {`These are the ${cases.length} most recently deleted. Restore one and the next older one shows here.`}
            </p>
          ) : null}
        </div>
      )}
    </SettingsCard>
  );
}
