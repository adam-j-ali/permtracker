import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const seen: unknown[] = [];
vi.mock("next/link", () => ({
  default: ({ prefetch, children, ...rest }: { prefetch?: unknown; children?: React.ReactNode }) => {
    seen.push(prefetch);
    return <a {...rest}>{children}</a>;
  },
}));

import { IntentLink } from "../intent-link";

const last = () => seen[seen.length - 1];

describe("IntentLink", () => {
  it("doesn't pre-load until the pointer is over it", () => {
    render(<IntentLink href="/tools">Calculators</IntentLink>);
    expect(last()).toBe(false);
    fireEvent.mouseEnter(screen.getByText("Calculators"));
    expect(last()).toBeNull();
  });

  it("arms on a touch and on keyboard focus too, and keeps the caller's handlers", () => {
    const onTouchStart = vi.fn();
    const onFocus = vi.fn();
    const { unmount } = render(
      <IntentLink href="/a" onTouchStart={onTouchStart}>
        A
      </IntentLink>,
    );
    fireEvent.touchStart(screen.getByText("A"));
    expect(last()).toBeNull();
    expect(onTouchStart).toHaveBeenCalledOnce();
    unmount();

    render(
      <IntentLink href="/b" onFocus={onFocus}>
        B
      </IntentLink>,
    );
    expect(last()).toBe(false);
    fireEvent.focus(screen.getByText("B"));
    expect(last()).toBeNull();
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it("keeps a caller's own prefetch choice once armed", () => {
    render(
      <IntentLink href="/c" prefetch>
        C
      </IntentLink>,
    );
    expect(last()).toBe(false);
    fireEvent.mouseEnter(screen.getByText("C"));
    expect(last()).toBe(true);
  });
});

describe("the page's frame pre-loads on intent", () => {
  // The header, footer, data rail and breadcrumbs show dozens of links on every
  // page; a plain next/link pre-loads each one as it scrolls into view.
  const frame = [
    "src/components/layout/SiteHeader.tsx",
    "src/components/layout/Footer.tsx",
    "src/components/layout/SiteBreadcrumbs.tsx",
    "src/components/tools/DataRail.tsx",
  ];
  it.each(frame)("%s renders no plain next/link", (file) => {
    const src = readFileSync(path.join(process.cwd(), file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");
    expect(src).not.toMatch(/import Link\b/);
    expect(src).not.toMatch(/<Link\b/);
    expect(src).toMatch(/<IntentLink\b/);
  });
});

describe("a strip of letters pre-loads on intent", () => {
  // The A to Z strip and its cards are 27 links on screen at once, on every employer, firm and wage index. Plain
  // links pre-loaded all of them in one second and the front door's limiter refused the burst (Nov 10 2026: 17
  // answers of 503 to one browser on /perm-employers).
  it("EntityBrowse draws each letter with IntentLink, and keeps the default for the names in its list", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/entities/EntityBrowse.tsx"), "utf8");
    expect(src).not.toMatch(/<Link\b[^>]*browseHref\(/);
    expect(src.match(/<IntentLink\b[^>]*browseHref\(/g)).toHaveLength(2);
    // A name in the list is the page's own content: it pre-loads as it comes into view, as content links do.
    expect(src).toMatch(/<Link translate="no" href=\{`\$\{base\}\/\$\{e\.slug\}`\}/);
  });
});
