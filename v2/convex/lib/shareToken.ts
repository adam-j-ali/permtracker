/**
 * The key in a recruitment record's share link (convex/recruitmentShares.ts): 32 random bytes, base64url, so 43
 * characters. Only its SHA-256 is stored, so the link can't be read back from the database or shown again; a
 * lost link is turned off and a new one made.
 *
 * Made in an action: queries and mutations deny cryptographic randomness. Pure otherwise, so the site can check a
 * link's shape the same way before asking Convex anything.
 */

/** Where a share link opens, on the site. */
export const SHARE_RECRUITMENT_PATH = "/share/recruitment/";

export const SHARE_TOKEN_LENGTH = 43;
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A new key. `randomBytes` is crypto.getRandomValues in production. */
export function newShareToken(randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let binary = "";
  for (const b of randomBytes(32)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether text has the shape of a key. The length is checked first, so a long string costs nothing. */
export function isShareToken(text: string): boolean {
  return text.length === SHARE_TOKEN_LENGTH && SHARE_TOKEN_RE.test(text);
}

/** What's stored for a key: its SHA-256, lowercase hex. */
export async function hashShareToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const SHARE_TOKEN_HASH_RE = /^[0-9a-f]{64}$/;
