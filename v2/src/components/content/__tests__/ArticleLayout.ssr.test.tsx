/**
 * @vitest-environment node
 *
 * Every guide and post opens with the case box; a release note doesn't.
 *
 * The box used to sit only after an article's last paragraph, where almost nobody reached it.
 * Server markup, because the box has to be there before any script runs.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import ArticleLayout from "../ArticleLayout";
import type { ContentType, PostMeta } from "@/lib/content/types";

const meta: PostMeta = {
  title: "How long a PERM case takes",
  description: "What DOL's published data says about the queue.",
  date: "2026-08-01",
  author: "PERM Tracker",
  tags: ["perm"],
  readingTime: "6 min read",
  published: true,
};

const page = (type: ContentType) =>
  renderToStaticMarkup(
    <ArticleLayout meta={meta} type={type} slug="how-long" related={[]}>
      <p>The first paragraph of the article.</p>
    </ArticleLayout>,
  );

describe("the case box on an article", () => {
  it.each(["guides", "blog"] as const)("sits between the header and the body of a %s article", (type) => {
    const html = page(type);
    const box = html.indexOf('aria-label="Check a case"');
    const body = html.indexOf("The first paragraph of the article.");

    // Control: the article itself rendered.
    expect(body).toBeGreaterThan(-1);
    expect(box).toBeGreaterThan(-1);
    expect(box).toBeLessThan(body);
    // It's the real case box: it posts a case number to the case page.
    expect(html.slice(box, body)).toContain('action="/perm-case-status"');
  });

  it("keeps the box at the article's end too, for someone who read to the bottom", () => {
    const html = page("guides");
    const body = html.indexOf("The first paragraph of the article.");

    expect(html.indexOf('action="/perm-case-status"', body)).toBeGreaterThan(body);
  });

  it("leaves a release note without the top box", () => {
    expect(page("changelog")).not.toContain('aria-label="Check a case"');
  });
});
