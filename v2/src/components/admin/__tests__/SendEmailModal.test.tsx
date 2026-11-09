import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/** What admin.sendAdminEmail answers: sent, or only kept in the retry queue (`queued`). */
const reply = vi.hoisted(() => ({ value: { success: true, queued: false } as { success: boolean; queued?: boolean } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("convex/react", () => ({ useAction: () => () => Promise.resolve(reply.value) }));
vi.mock("@/lib/toast", () => ({ toast }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

const { SendEmailModal } = await import("../SendEmailModal");

function send() {
  render(<SendEmailModal user={{ email: "reader@example.com", name: "Reader" }} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Your case" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A note." } });
  fireEvent.click(screen.getByRole("button", { name: "Send Email" }));
}

describe("SendEmailModal", () => {
  beforeEach(() => {
    toast.success.mockClear();
    toast.info.mockClear();
  });

  it("says the email was sent when Resend took it", async () => {
    reply.value = { success: true, queued: false };
    send();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Email sent to reader@example.com"));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("says it's queued, never sent, when it only waits in the retry queue", async () => {
    reply.value = { success: true, queued: true };
    send();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.info.mock.calls[0]?.[0]).toMatch(/queued/);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
