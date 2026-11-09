import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import ArticleHeader from "../ArticleHeader";

/**
 * An article's topic link opens the listing on that topic, as the topic cards' links do. It pointed at the topic's
 * section by anchor, which the listing's paging can leave off the page, so the link landed nowhere.
 */
describe("ArticleHeader's topic link", () => {
  it("opens the listing narrowed to the topic", () => {
    // Arrange, Act
    render(
      <ArticleHeader
        type="guides"
        meta={{ slug: "x", title: "A guide", description: "", date: "2026-11-01", category: "queue" } as never}
      />,
    );
    // Assert
    expect(screen.getByRole("link", { name: "Timing and the queue" })).toHaveAttribute("href", "/guides?topic=queue#articles");
  });
});
