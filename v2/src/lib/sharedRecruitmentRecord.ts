import "server-only";

import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";

import { api } from "@convex/_generated/api";

/** The record a share link opens (convex/recruitmentShares.ts recordByToken). */
export type SharedRecord = NonNullable<FunctionReturnType<typeof api.recruitmentShares.recordByToken>>;

/**
 * The record a share link opens, or null when the link is off or doesn't exist. Read fresh on every request and
 * never stored: the page is private, and it changes as the attorney's office works. Not `queryStatic`, which caches
 * a read for a page's window, and not `fetchQuery` from convex/nextjs (public-convex-reads.test.ts). A failed read
 * throws, so the page shows its error screen, never "this link is off".
 */
export async function readSharedRecord(token: string): Promise<SharedRecord | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  const client = new ConvexHttpClient(url, {
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  });
  return await client.query(api.recruitmentShares.recordByToken, { token });
}
