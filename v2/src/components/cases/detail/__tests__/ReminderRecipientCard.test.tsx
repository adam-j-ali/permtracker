/**
 * The Overview's "Reminders for someone else" card: it says what the second person gets, sends one invitation and
 * says why one couldn't go, shows the address and where it stands (waiting, confirmed, stopped, or an invitation that
 * failed), and removes it only after a confirm.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "@convex/_generated/dataModel";

type Recipient = {
  email: string | null;
  status: "waiting" | "confirmed" | "stopped";
  invitedAt: number;
  confirmedAt: number | null;
  stoppedAt: number | null;
  inviteFailed: boolean;
};

const state = vi.hoisted(() => ({
  recipient: undefined as Recipient | null | undefined,
  invite: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.recipient,
  useMutation: (ref: string) => (ref === "reminderRecipients:invite" ? state.invite : state.remove),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    reminderRecipients: {
      forCase: "reminderRecipients:forCase",
      invite: "reminderRecipients:invite",
      remove: "reminderRecipients:remove",
    },
  },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: state.toastError, success: state.toastSuccess } }));

const { ReminderRecipientCard } = await import("../ReminderRecipientCard");
const caseId = "c1" as Id<"cases">;
// 3 PM Eastern on Nov 20 2026.
const AT = Date.parse("2026-11-20T20:00:00Z");

const row = (over: Partial<Recipient>): Recipient => ({
  email: "para@firm.example",
  status: "waiting",
  invitedAt: AT,
  confirmedAt: null,
  stoppedAt: null,
  inviteFailed: false,
  ...over,
});

describe("a case's reminders for someone else", () => {
  afterEach(() => {
    state.recipient = undefined;
    for (const f of [state.invite, state.remove, state.toastError, state.toastSuccess]) f.mockReset();
  });

  it("says what the second person gets before anyone is added", () => {
    state.recipient = null;
    render(<ReminderRecipientCard caseId={caseId} />);
    expect(screen.getByRole("heading", { name: "Reminders for someone else" })).toBeInTheDocument();
    expect(screen.getByText(/like a paralegal or the employer's HR contact/)).toBeInTheDocument();
    expect(screen.getByText(/names the employer, the job title and the deadlines/)).toBeInTheDocument();
    expect(screen.getByText("We email them once to confirm. Nothing else is sent until they do.")).toBeInTheDocument();
    expect(screen.getByLabelText("Their email address")).toHaveAttribute("type", "email");
  });

  it("sends the invitation for this case with the typed address", async () => {
    state.recipient = null;
    state.invite.mockResolvedValue({ ok: true });
    render(<ReminderRecipientCard caseId={caseId} />);
    fireEvent.change(screen.getByLabelText("Their email address"), { target: { value: "para@firm.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(state.invite).toHaveBeenCalledWith({ caseId, email: "para@firm.example" }));
    await waitFor(() => expect(state.toastSuccess).toHaveBeenCalled());
  });

  it("says why an invitation couldn't go, beside the field", async () => {
    state.recipient = null;
    state.invite.mockResolvedValue({ ok: false, message: "That's your own address. Your reminders already come to you." });
    render(<ReminderRecipientCard caseId={caseId} />);
    const field = screen.getByLabelText("Their email address");
    fireEvent.change(field, { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That's your own address. Your reminders already come to you.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("asks for an address before sending anything", async () => {
    state.recipient = null;
    render(<ReminderRecipientCard caseId={caseId} />);
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Type their email address first.");
    expect(state.invite).not.toHaveBeenCalled();
  });

  it("shows a waiting invitation with its address and its thirty days", () => {
    state.recipient = row({});
    render(<ReminderRecipientCard caseId={caseId} />);
    expect(screen.getByText("Waiting to confirm")).toBeInTheDocument();
    expect(screen.getByText(/We've invited para@firm\.example\. Their reminders start once they confirm\./)).toBeInTheDocument();
    expect(screen.getByText(/within 30 days/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Their email address")).toBeNull();
  });

  it("says when an invitation couldn't be sent", () => {
    state.recipient = row({ inviteFailed: true });
    render(<ReminderRecipientCard caseId={caseId} />);
    expect(screen.getByText("We couldn't send the invitation to para@firm.example. Remove it and try again.")).toBeInTheDocument();
  });

  it("shows a confirmed address and the day it confirmed, in Eastern time", () => {
    state.recipient = row({ status: "confirmed", confirmedAt: AT });
    render(<ReminderRecipientCard caseId={caseId} />);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("para@firm.example gets this case's deadline reminders. They confirmed on November 20, 2026.")).toBeInTheDocument();
  });

  it("says the person stopped them, with no address left to show, and that it can't be added again", () => {
    state.recipient = row({ status: "stopped", email: null, confirmedAt: AT, stoppedAt: AT });
    render(<ReminderRecipientCard caseId={caseId} />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The second person stopped these reminders on November 20, 2026, and we deleted their address. That address can't be added again. Remove this to add someone else.",
      ),
    ).toBeInTheDocument();
  });

  it("says the person asked not to be invited, when they never confirmed", () => {
    state.recipient = row({ status: "stopped", email: null, confirmedAt: null, stoppedAt: AT });
    render(<ReminderRecipientCard caseId={caseId} />);
    expect(
      screen.getByText(
        "The person you invited asked not to get these reminders on November 20, 2026, and we deleted their address. That address can't be added again. Remove this to add someone else.",
      ),
    ).toBeInTheDocument();
  });

  it("removes only after a confirm", async () => {
    state.recipient = row({ status: "confirmed", confirmedAt: AT });
    state.remove.mockResolvedValue({ removed: true });
    render(<ReminderRecipientCard caseId={caseId} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(state.remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove para@firm.example?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(state.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith({ caseId }));
  });

  it("says a closed case has no reminders to send", () => {
    state.recipient = null;
    render(<ReminderRecipientCard caseId={caseId} closed />);
    expect(screen.getByText("This case is closed, so it has no reminders to send.")).toBeInTheDocument();
  });
});
