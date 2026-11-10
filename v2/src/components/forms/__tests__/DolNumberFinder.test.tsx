import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DolNumberFinder } from "../DolNumberFinder";

/**
 * Under a DOL case number field in the case form: one click opens the finder on the section's own filing day,
 * a picked case fills the number in, and nothing is read until the click.
 */
vi.mock("@/lib/funnelEvents", () => ({ trackFinder: vi.fn() }));

// The finder's answer (src/lib/findCase.ts): the one case on the day whose employer the name fits, of the two filed.
const answer = {
  program: "perm", asked: { employer: "acme", title: "", firm: "" }, by: "window", window: { from: "2026-01-30", to: "2026-01-30", assumed: false },
  cases: [{ caseNumber: "G-100-26030-000123", status: "ANALYST REVIEW", employer: "Acme Robotics, Inc.", jobTitle: "Controls Engineer", final: false, filedOn: "2026-01-30" }],
  matched: 1, ofEmployer: 1, capped: false, period: { filed: 2, decided: 1, waiting: 1 }, close: [], firmUnknown: false, decidedOnly: false,
};

function stub() {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
  return asked;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DolNumberFinder", () => {
  it("reads nothing until it's opened", () => {
    const asked = stub();
    render(<DolNumberFinder program="perm" day="2026-01-30" onPick={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Find it in DOL's record" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: /employer/i })).toBeNull();
    expect(asked).toEqual([]);
  });

  it("finds the employer's cases on the section's filing day and hands the picked number back, then closes", async () => {
    const asked = stub();
    const onPick = vi.fn();
    render(<DolNumberFinder program="perm" day="2026-01-30" onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Find it in DOL's record" }));
    fireEvent.change(screen.getByRole("textbox", { name: /employer/i }), { target: { value: "acme" } });
    const use = await screen.findByRole("button", { name: "Use this number: G-100-26030-000123" });
    expect(asked).toEqual(["/api/find-case?program=perm&employer=acme&from=2026-01-30&to=2026-01-30"]);
    fireEvent.click(use);
    expect(onPick).toHaveBeenCalledExactlyOnceWith("G-100-26030-000123");
    await waitFor(() => expect(screen.getByRole("button", { name: "Find it in DOL's record" })).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByRole("textbox", { name: /employer/i })).toBeNull();
  });

  it("looks through wage requests under the wage request's number, and says to enter the filing date when there's none", () => {
    const asked = stub();
    render(<DolNumberFinder program="pwd" day={undefined} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find it in DOL's record" }));
    fireEvent.change(screen.getByRole("textbox", { name: /employer/i }), { target: { value: "acme" } });
    expect(screen.getByText(/Pick the filing date above/)).toBeInTheDocument();
    expect(asked).toEqual([]);
  });
});
