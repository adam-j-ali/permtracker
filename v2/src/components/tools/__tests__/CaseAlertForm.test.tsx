import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/convexSite", () => ({ convexSiteUrl: (path: string) => `https://example.convex.site${path}` }));

import { CaseAlertForm, RETURNING_FROM_DAYS } from "../CaseAlertForm";
import { easternDay } from "@/lib/time";

const CASE = "G-100-26030-604655";
const asked = `pt-watch:${CASE}`;
const checks = `pt-checks:${CASE}`;
const daysAgo = (n: number) => new Date(Date.parse(`${easternDay()}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function reply(ok: boolean, message: string) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 400, json: async () => ({ ok, message }) });
}

async function send(address = "reader@example.com") {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Email me changes" }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  // Always, whatever the test did: one test swaps the browser's storage for one that throws.
  vi.unstubAllGlobals();
});

describe("the email box on a case's page", () => {
  it("asks in one line and says how often we check, so the reader can stop", () => {
    render(<CaseAlertForm caseNumber={CASE} />);

    expect(screen.getByLabelText("Email me when DOL changes this PERM case's status")).toBeInTheDocument();
    expect(screen.getByText(/We ask DOL about it every 5 minutes on weekdays, so you can stop checking\./)).toBeInTheDocument();
    expect(screen.queryByText(/You've checked this/)).toBeNull();
  });

  it("tells a browser on its third day of checking how many days it has checked", () => {
    // Two earlier days on record; today makes three.
    window.localStorage.setItem(checks, JSON.stringify([daysAgo(2), daysAgo(1)]));

    render(<CaseAlertForm caseNumber={CASE} />);

    expect(screen.getByText(new RegExp(`You've checked this PERM case on ${RETURNING_FROM_DAYS} days\\.`))).toBeInTheDocument();
  });

  it("doesn't count a second look on the same day", () => {
    window.localStorage.setItem(checks, JSON.stringify([daysAgo(1), easternDay()]));

    render(<CaseAlertForm caseNumber={CASE} />);

    expect(screen.queryByText(/You've checked this/)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(checks)!)).toHaveLength(2);
  });

  it("names the thing by its program", () => {
    window.localStorage.setItem(`pt-checks:P-100-26030-123456`, JSON.stringify([daysAgo(3), daysAgo(2), daysAgo(1)]));

    render(<CaseAlertForm caseNumber="P-100-26030-123456" program="pwd" />);

    expect(screen.getByText(/You've checked this prevailing wage request on 4 days\./)).toBeInTheDocument();
  });

  it("remembers the day a sign-up was sent, and shows the server's own words for this visit", async () => {
    vi.stubGlobal("fetch", reply(true, "Check your inbox to confirm."));
    render(<CaseAlertForm caseNumber={CASE} />);

    await send();

    await waitFor(() => expect(screen.getByText("Check your inbox to confirm.")).toBeInTheDocument());
    expect(window.localStorage.getItem(asked)).toBe(easternDay());
  });

  it("remembers nothing when the server refuses", async () => {
    vi.stubGlobal("fetch", reply(false, "That email address doesn't look right."));
    render(<CaseAlertForm caseNumber={CASE} />);

    await send();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That email address doesn't look right."));
    expect(window.localStorage.getItem(asked)).toBeNull();
  });

  it("shows a browser that already asked the day it asked, in place of the form", () => {
    window.localStorage.setItem(asked, "2026-11-09");

    render(<CaseAlertForm caseNumber={CASE} />);

    expect(screen.getByText("You asked for emails about this PERM case on November 9, 2026.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    // It says what the browser did, never that the address is subscribed.
    expect(document.body.textContent).not.toMatch(/subscribed|you're signed up/i);
  });

  it("lets them ask again, which brings the form back and forgets the day", () => {
    window.localStorage.setItem(asked, "2026-11-09");
    render(<CaseAlertForm caseNumber={CASE} />);

    act(() => fireEvent.click(screen.getByRole("button", { name: "ask again" })));

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(window.localStorage.getItem(asked)).toBeNull();
  });

  it("keeps one case's sign-up from hiding another case's form", () => {
    window.localStorage.setItem(asked, "2026-11-09");

    render(<CaseAlertForm caseNumber="G-100-26030-000001" />);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("still works in a browser that refuses its storage", async () => {
    const refuse = () => {
      throw new Error("SecurityError");
    };
    // The whole store is swapped, and unstubAllGlobals puts the real one back after the test. (A spy on
    // Storage.prototype outlived the test here and failed every test that ran after it.)
    vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse, removeItem: refuse, clear: () => {}, key: () => null, length: 0 });
    vi.stubGlobal("fetch", reply(true, "Check your inbox to confirm."));

    render(<CaseAlertForm caseNumber={CASE} />);
    await send();

    await waitFor(() => expect(screen.getByText("Check your inbox to confirm.")).toBeInTheDocument());
  });
});
