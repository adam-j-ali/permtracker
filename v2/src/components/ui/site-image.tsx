"use client";

import NextImage, { type ImageProps } from "next/image";

import { stableImageLoader } from "@/lib/imageLoader";

/**
 * Next's Image with the site's loader: every picture's address carries url, w and q, and keeps them from one deploy
 * to the next (src/lib/imageLoader.ts says why). Every picture on the site goes through here; site-image.test.tsx
 * fails a file that imports next/image itself.
 *
 * A client component because a loader is a function, and a function can't pass from a server component to Next's
 * Image. Server components render it all the same; the HTML holds the same <img>.
 */
export function SiteImage(props: ImageProps) {
  const src = typeof props.src === "string" ? props.src : null;
  // Next serves an SVG as it is when its own loader is in use; with a loader of ours it would send it through the
  // image server, which refuses SVG. Kept as Next keeps it.
  const svg = src !== null && src.split("?", 1)[0]!.endsWith(".svg");
  return <NextImage {...props} loader={stableImageLoader} unoptimized={props.unoptimized || svg} />;
}
