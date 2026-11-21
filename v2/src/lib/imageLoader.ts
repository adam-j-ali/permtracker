import type { ImageLoaderProps } from "next/image";

/**
 * The address of an optimized picture, as Next's own loader writes it but without the deploy's `dpl`.
 *
 * With `deploymentId` set (next.config.ts), Next's default loader adds `&dpl=<deploy>` to every `/_next/image`
 * address. On this one self-hosted server it routes nothing (every deploy serves the same public files), but it gave
 * each picture a fourth query parameter, which Ahrefs flags (133 addresses, Nov 20 2026), and a new address every
 * night, so crawlers and caches fetched every picture again after each deploy. A picture replaced under the same name
 * shows within the image server's cache time (`minimumCacheTTL`, 4 hours by Next's default).
 *
 * Used through SiteImage (src/components/ui/site-image.tsx), never as `images.loaderFile`: a config loader makes
 * Next answer `/_next/image` with a 404 (`loader !== 'default'` in next-server), so the image server would go dark.
 */

/** The image server's qualities: next.config.ts sets none, so Next's default list, which accepts 75 alone. */
export const IMAGE_QUALITIES: readonly number[] = [75];
const IMAGE_PATH = "/_next/image";

function closestQuality(quality: number | undefined): number {
  const q = quality || 75;
  return IMAGE_QUALITIES.reduce((best, cur) => (Math.abs(cur - q) < Math.abs(best - q) ? cur : best), IMAGE_QUALITIES[0]!);
}

/** A site path with the deploy's `dpl` taken off; any other query stays. */
function withoutDpl(src: string): string {
  if (!src.startsWith("/") || src.startsWith("//")) return src;
  const at = src.indexOf("?");
  if (at === -1) return src;
  const query = new URLSearchParams(src.slice(at + 1));
  query.delete("dpl");
  const rest = query.toString();
  return src.slice(0, at) + (rest ? `?${rest}` : "");
}

export function stableImageLoader({ src, width, quality }: ImageLoaderProps): string {
  return `${IMAGE_PATH}?url=${encodeURIComponent(withoutDpl(src))}&w=${width}&q=${closestQuality(quality)}`;
}
