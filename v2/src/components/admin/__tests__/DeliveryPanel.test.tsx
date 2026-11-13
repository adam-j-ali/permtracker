import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { Delivery } from "../DeliveryPanel";

/**
 * The latest alerts are a list that restacks, never a table: in a table the address column, free to break anywhere,
 * was given one letter's room on a phone (Nov 10 2026). Each alert exists once, and each part says what it is at
 * every width, because the column heads are drawn for wide screens only.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DeliveryPanel } = await import("../DeliveryPanel");

const SENT = Date.UTC(2026, 10, 10, 18, 7); // 1:07 PM Eastern
const alert = (over: Partial<Delivery["recent"][number]> = {}): Delivery["recent"][number] => ({
  email: "a.very.long.address.for.a.reader@example-mailbox.test",
  kind: "case",
  status: "sent",
  title: "G-100-26033-615104",
  line: "ANALYST REVIEW to CERTIFIED",
  createdAt: SENT,
  sentAt: SENT,
  bundleSize: null,
  direct: true,
  lastError: null,
  signedUpAt: SENT - 7 * 86_400_000,
  confirmedAt: SENT - 7 * 86_400_000 + 30_000,
  ...over,
});

const data = (recent: Delivery["recent"]): Delivery => ({
  pools: [],
  refusalDays: [],
  confirmationQueue: { waiting: 0, oldestQueuedAt: null },
  emailDay: { used: 0, listCeiling: 85, publicCeiling: 70, cap: 100, retrying: 0, oldestRetryAt: null, retriedToday: 0, lostToday: 0 },
  outbox: {
    queued: 0,
    oldestQueuedAt: null,
    last7d: { emails: 1, items: 1, bundles: 0, direct: 1, failed: 0, dropped: 0, byKind: { case: 1, queue: 0, bulletin: 0, employer: 0, match: 0 } },
  },
  recent,
  recentTotal: recent.length,
  follows: { confirmed: 0, pending: 0, unsubscribed: 0, top: [], employers: 0 },
});

const latest = () => screen.getByRole("heading", { name: "Latest alerts" }).closest("section")!;

describe("the admin page's latest alerts", () => {
  it("is a list with one item per alert, and no table to squeeze the address", () => {
    // Arrange, Act
    render(<DeliveryPanel data={data([alert(), alert({ email: "second@example.test", title: "G-100-26012-552943" })])} />);
    // Assert
    const section = latest();
    expect(section.querySelector("table")).toBeNull();
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(within(section).getAllByText(/a\.very\.long\.address/)).toHaveLength(1);
  });

  it("says what each part is in the row itself, since the column heads are for wide screens and hidden from readers", () => {
    // Arrange, Act
    render(<DeliveryPanel data={data([alert()])} />);
    // Assert
    const row = within(latest()).getByRole("listitem");
    expect(row).toHaveTextContent("Case status: G-100-26033-615104");
    expect(row).toHaveTextContent("ANALYST REVIEW to CERTIFIED");
    expect(row).toHaveTextContent(/State: sent/);
    expect(row).toHaveTextContent(/To a\.very\.long\.address\.for\.a\.reader@example-mailbox\.test/);
    expect(row).toHaveTextContent(/Sent Nov 10, 1:07 PM EST/);
    expect(row).toHaveTextContent(/Signed up Nov 3, 1:07 PM EST/);
    expect(row).toHaveTextContent("7 days before, confirmed after under a minute");
    expect(row).toHaveTextContent("straight out");
    const heads = latest().querySelector('[aria-hidden="true"]');
    expect(heads).toHaveTextContent("Sent Signed up To What State");
  });

  it("the address sits in a box with a width of its own, so it wraps inside that width", () => {
    // Arrange, Act
    render(<DeliveryPanel data={data([alert()])} />);
    // Assert: a grid item spanning the card on a phone, never a table cell
    const address = within(latest()).getByText(/a\.very\.long\.address/);
    expect(address.tagName).toBe("DIV");
    expect(address.className).toContain("col-span-2");
    expect(address.className).toContain("min-w-0");
    expect(address.closest("td")).toBeNull();
  });

  it("prints a failed send's error, a bundle's size, and a subscription that is gone", () => {
    // Arrange, Act
    render(
      <DeliveryPanel
        data={data([
          alert({ status: "failed", lastError: "rate_limit_exceeded: too many requests", direct: false, bundleSize: 3, signedUpAt: null, confirmedAt: null }),
        ])}
      />,
    );
    // Assert
    const row = within(latest()).getByRole("listitem");
    expect(row).toHaveTextContent("rate_limit_exceeded: too many requests");
    expect(row).toHaveTextContent("in a bundle of 3");
    expect(row).toHaveTextContent("subscription removed");
    expect(row).toHaveTextContent(/State: failed/);
  });

  it("says so when nothing was sent, with no empty list", () => {
    render(<DeliveryPanel data={data([])} />);
    expect(latest()).toHaveTextContent("No alert email recorded in the last 7 days.");
    expect(within(latest()).queryByRole("list")).toBeNull();
  });
});

describe("alerts waiting in the outbox", () => {
  // The tab's badge counts them, and nothing on the page said what they were waiting for.
  it("says how many are waiting, when they go, and that the once-a-day rule can hold one until tomorrow", () => {
    const waiting = data([]);
    waiting.outbox = { ...waiting.outbox, queued: 1, oldestQueuedAt: Date.now() - 3 * 3_600_000 };
    render(<DeliveryPanel data={waiting} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("1 alert is waiting to send.");
    expect(body).toContain("7:30 AM, 1:00 PM or 6:30 PM Eastern");
    expect(body).toContain("already emailed today waits for tomorrow");
  });

  it("says nothing of the kind when the outbox is empty", () => {
    render(<DeliveryPanel data={data([])} />);
    expect(document.body.textContent ?? "").not.toContain("waiting to send");
  });
});

describe("employer follows, on a phone", () => {
  // Three boxes across left about 45px for a label: "not confirmed" ran out of its box and "following" touched the
  // edge (the owner's phone, Nov 13 2026). And a long employer name pushed its count onto two lines ("2", then
  // "following").
  const follows = (): Delivery => ({
    ...data([]),
    follows: {
      confirmed: 70,
      pending: 24,
      unsubscribed: 0,
      employers: 55,
      top: [{ slug: "cognizant-technology-solutions-us-corporation", name: "Cognizant Technology Solutions US Corporation", followers: 2 }],
    },
  });
  const section = () => screen.getByRole("heading", { name: "Employer follows" }).closest("section")!;

  it("stacks the three figures in one column on a phone, each a number with its label beside it", () => {
    // Arrange, Act
    render(<DeliveryPanel data={follows()} />);
    const figure = within(section()).getByText("not confirmed").closest("div")!;
    const grid = figure.parentElement!;
    // Assert: one column until there's room for three, and never three squeezed onto a phone.
    expect(grid.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(grid.className).toMatch(/(^|\s)sm:grid-cols-3(\s|$)/);
    expect(grid.className).not.toMatch(/(^|\s)grid-cols-3(\s|$)/);
    // The number and its label share a line on a phone and stack from the same width up.
    expect(figure.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(figure.className).toMatch(/(^|\s)sm:block(\s|$)/);
    expect(figure.textContent).toContain("24");
  });

  it("keeps an employer's count on one line, so a long name wraps and the count doesn't", () => {
    render(<DeliveryPanel data={follows()} />);
    const count = within(section()).getByText("2 following");
    expect(count.className).toContain("whitespace-nowrap");
    expect(count.className).toContain("shrink-0");
  });

  it("leaves the outbox's six figures as they were: two across on a phone", () => {
    render(<DeliveryPanel data={follows()} />);
    const grid = screen.getByText("emails sent").closest("div")!.parentElement!;
    expect(grid.className).toMatch(/(^|\s)grid-cols-2(\s|$)/);
    expect(screen.getByText("emails sent").closest("div")!.className).not.toMatch(/(^|\s)sm:block(\s|$)/);
  });
});
