/**
 * The Recruitment tab's "Share with your client" card: it says who can see the record (anyone with the link), makes
 * the link and shows it once with a copy button, says when a live link was made and last opened, and turns the link
 * off only after a confirm.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "@convex/_generated/dataModel";

const state = vi.hoisted(() => ({
  link: undefined as null | undefined | { createdAt: number; lastViewedOn: string | null },
  create: vi.fn(),
  turnOff: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.link,
  useAction: () => state.create,
  useMutation: () => state.turnOff,
}));
vi.mock("@convex/_generated/api", () => ({
  api: { recruitmentShares: { forCase: "recruitmentShares:forCase", create: "recruitmentShares:create", turnOff: "recruitmentShares:turnOff" } },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: state.toastError, success: state.toastSuccess } }));

const { ShareWithClient } = await import("../ShareWithClient");
const caseId = "c1" as Id<"cases">;
const URL = "https://permtracker.app/share/recruitment/Zk3_x-9QwErTyUiOpAsDfGhJkLzXcVbNm1234567890";
// 3 PM Eastern on Nov 20 2026.
const MADE = Date.parse("2026-11-20T20:00:00Z");

describe("sharing the record with the client", () => {
  afterEach(() => {
    state.link = undefined;
    for (const f of [state.create, state.turnOff, state.toastError, state.toastSuccess]) f.mockReset();
  });

  it("says who can see it, and what stays private, before anything is made", () => {
    state.link = null;
    render(<ShareWithClient caseId={caseId} />);
    expect(screen.getByRole("heading", { name: "Share with your client" })).toBeInTheDocument();
    expect(screen.getByText(/Anyone with the link can see it, with no sign-in\./)).toBeInTheDocument();
    expect(screen.getByText(/beneficiary, notes, documents, case numbers and the wage aren't shown/)).toBeInTheDocument();
  });

  it("makes the link, then shows it once with a copy button", async () => {
    state.link = null;
    state.create.mockResolvedValue({ ok: true, url: URL, createdAt: MADE });
    render(<ShareWithClient caseId={caseId} />);
    fireEvent.click(screen.getByRole("button", { name: "Share with your client" }));
    await waitFor(() => expect(screen.getByText(URL)).toBeInTheDocument());
    expect(state.create).toHaveBeenCalledWith({ caseId });
    expect(screen.getByText(/Copy it now: it isn't shown again\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("says why a link couldn't be made", async () => {
    state.link = null;
    state.create.mockResolvedValue({ ok: false, message: "This case already has a link. Turn it off to make a new one." });
    render(<ShareWithClient caseId={caseId} />);
    fireEvent.click(screen.getByRole("button", { name: "Share with your client" }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("This case already has a link. Turn it off to make a new one."));
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("says when a live link was made and last opened, and never shows the link again", () => {
    state.link = { createdAt: MADE, lastViewedOn: "2026-11-21" };
    render(<ShareWithClient caseId={caseId} />);
    expect(screen.getByText(/The link is on\. Anyone with it can see this record\./)).toBeInTheDocument();
    expect(screen.getByText(/Made November 20, 2026\. Last opened November 21, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with your client" })).toBeNull();
    expect(screen.queryByText(/share\/recruitment\//)).toBeNull();
  });

  it("says a live link hasn't been opened yet", () => {
    state.link = { createdAt: MADE, lastViewedOn: null };
    render(<ShareWithClient caseId={caseId} />);
    expect(screen.getByText(/Not opened yet\./)).toBeInTheDocument();
  });

  it("turns the link off only after a confirm, and keeps it on when told to", async () => {
    state.link = { createdAt: MADE, lastViewedOn: null };
    state.turnOff.mockResolvedValue({ turnedOff: true });
    render(<ShareWithClient caseId={caseId} />);

    fireEvent.click(screen.getByRole("button", { name: "Turn off the link" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep it on" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(state.turnOff).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Turn off the link" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off the link" }));
    await waitFor(() => expect(state.turnOff).toHaveBeenCalledWith({ caseId }));
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalledWith("The link is off."));
  });
});
