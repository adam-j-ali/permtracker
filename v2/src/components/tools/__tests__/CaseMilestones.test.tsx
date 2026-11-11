import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CaseMilestones } from "../CaseMilestones";

/**
 * The case page's timeline form. What must hold: nothing renders for a
 * number that isn't PERM; the public box starts unticked; a save sends a
 * 64-hex key it then keeps; nothing is sent when no date after PERM is given;
 * and the counts come from the summary route, never invented.
 */

const CASE = "G-100-25324-425560";
const calls: { url: string; body: Record<string, unknown> | null }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ url, body });
      if (url.includes("/timeline/summary")) {
        return new Response(
          JSON.stringify({
            caseNumber: CASE,
            timelines: 1,
            stops: [
              { id: "i140FiledOn", label: "I-140 filed", verified: false, count: 2 },
              { id: "i140ApprovedOn", label: "I-140 approved", verified: false, count: 0 },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/timeline/save")) {
        return new Response(JSON.stringify({ ok: true, message: "Your timeline is recorded." }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, mine: null }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CaseMilestones (the timeline form)", () => {
  it("says a returning visitor's saved timeline is loading, not \"Add your dates\"", async () => {
    window.localStorage.setItem(`pt-timeline-key:${CASE}`, "a".repeat(64));
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("/timeline/mine") ? new Promise<Response>(() => {}) : Promise.resolve(new Response("null", { status: 200 })),
      ),
    );
    render(<CaseMilestones caseNumber={CASE} />);
    expect(await screen.findByText("Loading your timeline…")).toBeInTheDocument();
    expect(screen.queryByText("Add your dates")).toBeNull();
  });

  it("renders nothing for a number that is not a PERM case", () => {
    const { container } = render(<CaseMilestones caseNumber="P-100-26125-868956" />);
    expect(container.innerHTML).toBe("");
  });

  it("says the counts wait for three people when the server withholds them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/timeline/summary")
          ? new Response(JSON.stringify({ caseNumber: CASE, timelines: 0, stops: [], withheld: true }), { status: 200 })
          : new Response(JSON.stringify({ ok: true, mine: null }), { status: 200 }),
      ),
    );
    render(<CaseMilestones caseNumber={CASE} />);
    expect(await screen.findByText("Dates people add for this case show here once three have added them.")).toBeInTheDocument();
    expect(screen.queryByText("Nobody has added dates for this case yet.")).toBeNull();
  });

  it("names the reported stops from the summary route, and only those", async () => {
    render(<CaseMilestones caseNumber={CASE} />);
    const line = (await screen.findByText(/Reported for this case/)).textContent ?? "";
    expect(line).toMatch(/Reported for this case: I-140 filed \(2\)\./);
    // A stop nobody reported isn't listed.
    expect(line).not.toMatch(/I-140 approved/);
  });

  it("starts with the public box unticked", () => {
    render(<CaseMilestones caseNumber={CASE} />);
    expect(screen.getByRole("checkbox", { name: /show my timeline in the public lists/i })).not.toBeChecked();
  });

  it("refuses to send a timeline with no date after PERM", async () => {
    render(<CaseMilestones caseNumber={CASE} />);
    fireEvent.click(screen.getByRole("button", { name: /save my timeline/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least one date/i);
    expect(calls.some((c) => c.url.includes("/timeline/save"))).toBe(false);
  });

  it("sends a 64-hex key with the fields and keeps the key for next time", async () => {
    render(<CaseMilestones caseNumber={CASE} />);
    fireEvent.change(screen.getByLabelText("I-140 filed"), { target: { value: "2026-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: /save my timeline/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/timeline/save"))).toBe(true));
    const sent = calls.find((c) => c.url.includes("/timeline/save"))!.body!;
    expect(sent.caseNumber).toBe(CASE);
    expect(sent.key).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.i140FiledOn).toBe("2026-05-01");
    expect(sent.public).toBe(false);
    await waitFor(() => expect(window.localStorage.getItem(`pt-timeline-key:${CASE}`)).toBe(sent.key));
  });

  it("asks for the USCIS office and the biometrics date, and offers only the categories that have a PERM", () => {
    render(<CaseMilestones caseNumber={CASE} />);
    expect(screen.getByLabelText("USCIS office handling the I-485")).toBeInTheDocument();
    expect(screen.getByLabelText("Biometrics appointment")).toBeInTheDocument();
    const categories = Array.from((screen.getByLabelText("Category") as HTMLSelectElement).options).map((o) => o.value);
    expect(categories).toEqual(["", "eb2", "eb3", "eb3-other"]);
  });

  it("says a saved timeline waits for review until it's been checked", async () => {
    window.localStorage.setItem(`pt-timeline-key:${CASE}`, "a".repeat(64));
    const mine = { input: { i140FiledOn: "2026-05-01" }, caseNumber: CASE, status: "pending", permFiledOn: null, permCertifiedOn: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/timeline/mine")
          ? new Response(JSON.stringify({ ok: true, mine }), { status: 200 })
          : new Response(JSON.stringify({ caseNumber: CASE, timelines: 0, stops: [], withheld: true }), { status: 200 }),
      ),
    );
    render(<CaseMilestones caseNumber={CASE} />);
    expect(await screen.findByText(/Waiting for review/)).toBeInTheDocument();
    expect(screen.getByText("Your timeline for this case")).toBeInTheDocument();
  });

  it("opens a timeline this browser saved elsewhere with no case number, and saving ties it to this case", async () => {
    window.localStorage.setItem("pt-timeline-key", "b".repeat(64));
    const mine = { input: { fieldOffice: "HAR", i485FiledOn: "2025-05-01", category: "eb2" }, caseNumber: null, status: "approved", permFiledOn: null, permCertifiedOn: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        calls.push({ url, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
        if (url.includes("/timeline/mine")) return new Response(JSON.stringify({ ok: true, mine }), { status: 200 });
        if (url.includes("/timeline/save")) return new Response(JSON.stringify({ ok: true, status: "approved", message: "Your timeline was updated." }), { status: 200 });
        return new Response(JSON.stringify({ caseNumber: CASE, timelines: 0, stops: [], withheld: true }), { status: 200 });
      }),
    );
    render(<CaseMilestones caseNumber={CASE} />);
    expect(await screen.findByText("Your timeline for this case")).toBeInTheDocument();
    await waitFor(() => expect((screen.getByLabelText("I-485 filed") as HTMLInputElement).value).toBe("2025-05-01"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/timeline/save"))).toBe(true));
    const sent = calls.find((c) => c.url.includes("/timeline/save"))!.body!;
    expect(sent).toMatchObject({ caseNumber: CASE, key: "b".repeat(64), fieldOffice: "HAR", i485FiledOn: "2025-05-01" });
  });

  it("leaves a timeline that names another case, or a category with no PERM, where it is", async () => {
    window.localStorage.setItem("pt-timeline-key", "b".repeat(64));
    for (const mine of [
      { input: { i485FiledOn: "2025-05-01" }, caseNumber: "G-100-25324-999999", status: "approved", permFiledOn: null, permCertifiedOn: null },
      { input: { i485FiledOn: "2025-05-01", category: "eb2-niw" }, caseNumber: null, status: "approved", permFiledOn: null, permCertifiedOn: null },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.includes("/timeline/mine")
            ? new Response(JSON.stringify({ ok: true, mine }), { status: 200 })
            : new Response(JSON.stringify({ caseNumber: CASE, timelines: 0, stops: [], withheld: true }), { status: 200 }),
        ),
      );
      const { unmount } = render(<CaseMilestones caseNumber={CASE} />);
      expect(await screen.findByText("Add your dates")).toBeInTheDocument();
      expect(screen.queryByText("Your timeline for this case")).toBeNull();
      unmount();
    }
  });
});
