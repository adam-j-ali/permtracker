import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmployerFollow } from "../EmployerFollow";
import type { EmployerMove } from "@/lib/employerStages";

/**
 * The follow panel must say WHY it has nothing to show. Before Sep 29 2026 a
 * stale census rendered "Nothing employer-wide in this site's record", a
 * false statement, and an employer under the census's five-case floor got no
 * sentence at all.
 */

const move = (i: number): EmployerMove => ({
  key: `2026-09-${String(10 + i).padStart(2, "0")}|hold-on|APPLICATION ON HOLD`,
  date: `2026-09-${String(10 + i).padStart(2, "0")}`,
  worked: [`2026-09-${String(10 + i).padStart(2, "0")}`],
  slug: "acme",
  name: "ACME",
  sentence: `DOL put ${i + 5} of its cases on hold.`,
  tone: "neutral",
  n: i + 5,
});

const base = { slug: "acme", name: "ACME", logFrom: "2026-08-27", asOf: "2026-09-28" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("EmployerFollow", () => {
  it("says the census is unavailable instead of claiming nothing happened", () => {
    render(<EmployerFollow {...base} row={null} moves={[]} docMissing />);
    expect(screen.getByText(/couldn.t be read or is more than eight days old/)).toBeTruthy();
    expect(screen.getByText(/can.t say whether DOL has moved its cases/)).toBeTruthy();
    expect(screen.queryByText(/Nothing employer-wide/)).toBeNull();
  });

  it("says an employer is under the census floor rather than drawing nothing", () => {
    render(<EmployerFollow {...base} row={null} moves={[]} />);
    expect(screen.getByText(/Fewer than five of its PERM cases are pending/)).toBeTruthy();
    expect(screen.getByText(/Nothing employer-wide since this site.s record began/)).toBeTruthy();
  });

  it("offers every case as a tick box, ticked for an employer with few pending cases", () => {
    // Arrange: under five pending cases, so the census has no row.
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    // Act
    render(<EmployerFollow {...base} row={null} moves={[]} />);
    // Assert
    const every = screen.getByRole("checkbox", { name: /Every case too/ }) as HTMLInputElement;
    expect(every.checked).toBe(true);
    fireEvent.click(every);
    expect(every.checked).toBe(false);
  });

  it("leaves it unticked for a big employer, and when the census can't say how big it is", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    const big = { name: "ACME", slug: "acme", pending: 400, review: 0, share: 0, byStatus: { "ANALYST REVIEW": 400 } };
    const { unmount } = render(<EmployerFollow {...base} row={big} moves={[]} />);
    expect((screen.getByRole("checkbox", { name: /Every case too/ }) as HTMLInputElement).checked).toBe(false);
    unmount();
    render(<EmployerFollow {...base} row={null} moves={[]} docMissing />);
    expect((screen.getByRole("checkbox", { name: /Every case too/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("sends the size that's ticked", async () => {
    // Arrange
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        posted.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ ok: true, message: "Check your inbox to confirm." }), { status: 200 });
      }),
    );
    render(<EmployerFollow {...base} row={null} moves={[]} />);
    // Act
    fireEvent.change(screen.getByLabelText("Your email address"), { target: { value: "hr@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    // Assert
    expect(await screen.findByText("Check your inbox to confirm.")).toBeTruthy();
    expect(posted).toEqual([{ email: "hr@example.com", slug: "acme", source: "employer-page", scope: "each" }]);
  });

  it("keeps every earlier move reachable behind a show-more", () => {
    const moves = Array.from({ length: 9 }, (_, i) => move(i));
    render(<EmployerFollow {...base} row={null} moves={moves} />);
    expect(screen.getByText("Show the 3 earlier moves")).toBeTruthy();
    for (const m of moves) expect(screen.getByText(m.sentence)).toBeTruthy();
  });
});
