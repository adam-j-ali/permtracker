import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { rehypeKeepProgramNames } from "./rehypeKeepProgramNames";

// next-mdx-remote 6 (the Feb 12 2026 fix for CVE-2026-0969) strips every
// JavaScript expression by default, which is right for untrusted MDX and wrong
// here: every source is a file in this repo, and with expressions stripped each
// `rows={[...]}` reached ComparisonTable empty, so 17 articles shipped their
// comparison tables blank for eight months (found Oct 9 2026). Expressions are
// allowed; blockDangerousJS (on by default) still removes eval, Function,
// require, process and the rest of its list.
//
// The program-name plugin runs last, after the heading ids and their links are
// made, so a heading's id is read from its words exactly as before.
export const MDX_OPTIONS = {
  blockJS: false,
  blockDangerousJS: true,
  mdxOptions: {
    remarkPlugins: [remarkGfm] as import("unified").Pluggable[],
    rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings, rehypeKeepProgramNames] as import("unified").Pluggable[],
  },
};
