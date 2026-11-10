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
  useLinkStatus: () => ({ pending: false }),
}));

import { IntentLink } from "../intent-link";
import { PendingLink } from "../pending-link";

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
  it("EntityBrowse draws each letter with IntentLink, and each name in its list", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/entities/EntityBrowse.tsx"), "utf8");
    expect(src).not.toMatch(/<Link\b[^>]*browseHref\(/);
    expect(src.match(/<IntentLink\b[^>]*browseHref\(/g)).toHaveLength(2);
    // A name in the list is a row like any other list's: its page is a whole employer, firm or job to build.
    expect(src).toMatch(/<IntentLink translate="no" href=\{`\$\{base\}\/\$\{e\.slug\}`\}/);
  });
});

describe("the rows of a list pre-load on intent", () => {
  // Each row of a list draws two or three links (the case number, the employer, the firm or the job), and a plain
  // next/link asks the server for every one as its row scrolls into view. Measured Nov 10 2026: the pages sending
  // the most pre-loads were the lists below, and one employer's page drew about 80 such links.
  const lists = [
    "src/components/tools/UnifiedCaseSearch.tsx",
    "src/components/tools/CaseBrowser.tsx",
    "src/components/tools/FlagCaseBrowser.tsx",
    "src/components/tools/LiveCaseBrowser.tsx",
    "src/components/activity/DecidedTable.tsx",
    "src/components/activity/ChangeTable.tsx",
    "src/components/queue/DayCaseRow.tsx",
    "src/components/queue/MonthEmployers.tsx",
    "src/components/rfi/StageCaseBrowser.tsx",
    "src/components/entities/FilingRows.tsx",
    "src/components/entities/FilingMakeup.tsx",
    "src/components/entities/WageAndLcaFilings.tsx",
    "src/components/tools/EntityContext.tsx",
    "src/components/entities/EntityBrowse.tsx",
  ];
  const code = (file: string) =>
    readFileSync(path.join(process.cwd(), file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line))
      .join("\n");

  it.each(lists)("%s renders no plain next/link", (file) => {
    const src = code(file);
    expect(src).not.toMatch(/import Link\b/);
    expect(src).not.toMatch(/<Link\b/);
    expect(src).toMatch(/<(IntentLink|PendingLink)\b/);
  });

  it("the check finds a plain link when a list has one", () => {
    const withOne = 'import Link from "next/link";\n<td><Link href={entityHref("employer", r.slug)}>{r.name}</Link></td>';
    expect(withOne).toMatch(/import Link\b/);
    expect(withOne).toMatch(/<Link\b/);
    expect("<IntentLink href={a}>x</IntentLink>").not.toMatch(/<Link\b/);
  });

  it("a case number in a browser (PendingLink) waits for intent too, and still shows its pending mark", () => {
    const { container } = render(<PendingLink href="/perm-case-status?case=G-100-26028-598287">G-100-26028-598287</PendingLink>);
    expect(last()).toBe(false);
    fireEvent.mouseEnter(screen.getByText("G-100-26028-598287"));
    expect(last()).toBeNull();
    // The mark is always in the link, hidden until a slow navigation is pending.
    expect(container.querySelector("a span[aria-hidden='true']")).not.toBeNull();
  });
});
