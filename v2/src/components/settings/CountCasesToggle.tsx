"use client";

/**
 * CountCasesToggle
 *
 * Settings switch: count this account's cases in the public figures. Off unless the person switches it on. When on,
 * the hourly merge of reported cases (convex/caseFigures.ts, scripts/build_reported_cases.py) counts each saved case's
 * dates toward the waits the public pages show, and lists none of them. Switched off, they leave the figures at the
 * next hourly build. The Privacy Policy says the same, under "Cases you choose to count in the public figures".
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { SettingsCard, SettingsCardSkeleton } from "./SettingsCard";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthContext } from "@/lib/contexts/AuthContext";
import { handleOperationError } from "@/lib/errors";
import { KeepWhole } from "@/components/ui/keep-whole";

export default function CountCasesToggle() {
  const { isSigningOut } = useAuthContext();
  const [isUpdating, setIsUpdating] = useState(false);
  const profile = useQuery(api.users.currentUserProfile, isSigningOut ? "skip" : undefined);
  const setCountCaseDates = useMutation(api.users.setCountCaseDates);

  const handleToggle = async (checked: boolean) => {
    setIsUpdating(true);
    try {
      await setCountCaseDates({ on: checked });
    } catch (error) {
      handleOperationError(error, { userMessage: "Couldn’t save the setting. Try again." });
    } finally {
      setIsUpdating(false);
    }
  };

  if (profile === undefined) {
    return (
      <SettingsCardSkeleton>
        <Skeleton variant="line" className="h-6 w-1/3" />
        <Skeleton variant="line" className="h-4 w-2/3" />
      </SettingsCardSkeleton>
    );
  }

  return (
    <SettingsCard title="Public wait times">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <Label htmlFor="count-cases-toggle" className="text-sm font-medium text-foreground">
            Count my cases in the public figures
          </Label>
          <p id="count-cases-description" className="mt-1 text-sm text-muted-foreground">
            <KeepWhole>
              {"The dates on your cases (when each step was filed and decided), the I-140's category and premium " +
                "processing count toward the waits on the site's public pages. No name, employer, job, case number " +
                "or note is shared, and no case is ever listed or shown on its own. Switch it off and they leave " +
                "the figures within the hour."}
            </KeepWhole>{" "}
            <Link href="/privacy#counted-cases" className="link">
              How it&apos;s handled
            </Link>
          </p>
        </div>
        <Switch
          id="count-cases-toggle"
          checked={profile?.countCaseDates === true}
          onCheckedChange={handleToggle}
          disabled={isUpdating || !profile}
          aria-describedby="count-cases-description"
        />
      </div>
    </SettingsCard>
  );
}
