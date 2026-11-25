import type { ArticleRef } from "./didYouMean";
import { lazyList } from "./lazyList";

/** The article list from /articles.json, fetched at most once per visit (lazyList). */
const articles = lazyList<ArticleRef>("/articles.json");

export const loadArticles = articles.load;

/** The article list once `enabled`; `failed` when it couldn't be read, `ready` once it has been. */
export function useArticles(enabled: boolean): { articles: ArticleRef[]; failed: boolean; ready: boolean } {
  const { list, failed, ready } = articles.useList(enabled);
  return { articles: list, failed, ready };
}

/** For tests: forget the fetched list. */
export const resetArticleList = articles.reset;
