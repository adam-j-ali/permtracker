import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A quarter post's "newer file" note links the newest quarter's post only once that post exists: DOL's file lands
 * days before its post is written, and the note linked a page that answered 404 in between.
 */
const posts = vi.hoisted(() => ({ existing: new Set<string>() }));
vi.mock("@/lib/db/quarterReport", () => ({
  getQuarterReport: vi.fn(async () => ({ quarter: { key: "2026-3" } })),
  getNewestQuarterKey: vi.fn(async () => "2026-4"),
}));
vi.mock("@/lib/content", () => ({
  getPostBySlug: (_type: string, slug: string) => (posts.existing.has(slug) ? { slug } : null),
}));

const { QuarterNow } = await import("../QuarterNow");

/** The "newer" part, rendered: QuarterNow hands back its async child, which is awaited here as the server would. */
async function newer(): Promise<ReactElement | null> {
  const el = (await QuarterNow({ quarter: "2026-3", part: "newer" })) as ReactElement<Record<string, unknown>>;
  const child = el.type as (p: unknown) => Promise<ReactElement | null>;
  return child(el.props);
}

describe("QuarterNow's newer-file note", () => {
  it("says nothing while the newest quarter's post isn't written yet", async () => {
    // Arrange
    posts.existing.clear();
    // Act, Assert
    expect(await newer()).toBeNull();
  });

  it("links the newest quarter's post once it exists", async () => {
    // Arrange
    posts.existing.add("dol-perm-file-fy2026-q4");
    // Act
    const note = await newer();
    render(note!);
    // Assert
    expect(screen.getByRole("link", { name: "What the newest file says" })).toHaveAttribute("href", "/blog/dol-perm-file-fy2026-q4");
  });
});
