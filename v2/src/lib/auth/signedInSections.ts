/**
 * The signed-in app's sections. Every page under one needs a sign-in (`src/proxy.ts` guards them from this list),
 * and anything that shows a link only a signed-in person can open asks `isSignedInPath` first.
 */
export const SIGNED_IN_SECTIONS = [
  "/dashboard",
  "/cases",
  "/calendar",
  "/timeline",
  "/settings",
  "/notifications",
  "/admin",
] as const;

/** Whether a page's path is in the signed-in app: a section itself or any page under it. */
export function isSignedInPath(pathname: string): boolean {
  return SIGNED_IN_SECTIONS.some((s) => pathname === s || pathname.startsWith(`${s}/`));
}
