/**
 * ArticleLayout
 *
 * Shared layout for individual article/post pages.
 * Two-column: content + sidebar (TOC).
 * Delegates animated sections to client components (ArticleHeader, ArticleSidebar).
 * MDX content renders as server components passed through as children.
 */

import type { PostMeta, ContentType, PostSummary } from "@/lib/content/types";
import { ArticleCaseBox } from "./ArticleCaseBox";
import ArticleHeader from "./ArticleHeader";
import ArticleBody from "./ArticleBody";
import RelatedPosts from "./RelatedPosts";
import ContentCTA from "./ContentCTA";
import ReadingProgress from "./ReadingProgress";

interface ArticleLayoutProps {
  meta: PostMeta;
  type: ContentType;
  slug: string;
  related: PostSummary[];
  children: React.ReactNode;
}

export default function ArticleLayout({
  meta,
  type,
  slug,
  related,
  children,
}: ArticleLayoutProps) {
  const url = `/${type}/${slug}`;

  return (
    <article>
      {/* A lime bar along the top of the screen that fills as the article is read. */}
      <ReadingProgress />
      <ArticleHeader meta={meta} type={type} />
      {/* Guides and posts open with the case box, like every other page. A release note is for a different reader. */}
      {type === "changelog" ? null : <ArticleCaseBox />}

      <ArticleBody title={meta.title} url={url}>
        {children}
      </ArticleBody>{" "}

      <ContentCTA />
      {related.length > 0 && <RelatedPosts posts={related} />}
    </article>
  );
}
