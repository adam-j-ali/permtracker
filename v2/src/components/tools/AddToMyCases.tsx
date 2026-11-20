import Link from "next/link";
import { PlusCircleIcon } from "@phosphor-icons/react/ssr";

import { dolCarryHref, type DolCarried } from "@/lib/dolCarried";

/**
 * "Add to my cases" under a public PERM case or PERM wage request: the case into the app, filled from DOL's public
 * record (src/lib/dolCarried.ts). Signing in on the way keeps the record, and the form shows it to check before saving.
 * Nothing for a number the app doesn't track.
 */
export function AddToMyCases({ record }: { record: DolCarried }) {
  const href = dolCarryHref(record);
  if (!href) return null;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
      <PlusCircleIcon aria-hidden="true" className="size-5 shrink-0 text-primary-text" />{" "}
      <Link href={href} className="link -my-2 inline-flex min-h-11 items-center font-semibold">
        Add to my cases
      </Link>{" "}
      <span className="text-muted-foreground">Keep it with its deadlines in a free account, filled from DOL&apos;s record.</span>
    </p>
  );
}
