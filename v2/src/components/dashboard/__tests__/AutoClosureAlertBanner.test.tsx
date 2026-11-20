import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dismissOne = vi.fn();
const dismissAll = vi.fn();
const reopen = vi.fn();
let mutationIndex = 0;

vi.mock("convex/react", () => ({
  useQuery: () => [
    {
      notificationId: "n1",
      caseId: "c1",
      employerName: "Acme Corp",
      positionTitle: "Engineer",
      closureReason: "pwd_expired",
      createdAt: Date.now() - 3_600_000,
    },
  ],
  // The banner asks for its mutations in this order each render: dismiss one, dismiss all, reopen.
  useMutation: () => [dismissOne, dismissAll, reopen][mutationIndex++ % 3],
}));
vi.mock("@/lib/contexts/AuthContext", () => ({ useAuthContext: () => ({ isSigningOut: false }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AutoClosureAlertBanner from "../AutoClosureAlertBanner";

describe("the closure banner", () => {
  beforeEach(() => {
    mutationIndex = 0;
    vi.clearAllMocks();
    reopen.mockResolvedValue({ success: true, newCaseStatus: "pwd" });
    dismissOne.mockResolvedValue(null);
  });

  it("reopens a case from its row, then clears that alert", async () => {
    render(<AutoClosureAlertBanner />);
    await userEvent.click(screen.getByRole("button", { name: "Reopen Acme Corp - Engineer" }));
    await waitFor(() => expect(dismissOne).toHaveBeenCalledWith({ notificationId: "n1" }));
    expect(reopen).toHaveBeenCalledWith({ id: "c1" });
    expect(reopen.mock.invocationCallOrder[0]!).toBeLessThan(dismissOne.mock.invocationCallOrder[0]!);
  });

  it("keeps the alert when the reopen fails", async () => {
    reopen.mockRejectedValue(new Error("nope"));
    render(<AutoClosureAlertBanner />);
    await userEvent.click(screen.getByRole("button", { name: "Reopen Acme Corp - Engineer" }));
    await waitFor(() => expect(reopen).toHaveBeenCalled());
    expect(dismissOne).not.toHaveBeenCalled();
  });

  it("names its view and dismiss controls for a screen reader", () => {
    render(<AutoClosureAlertBanner />);
    expect(screen.getByRole("link", { name: "View Acme Corp - Engineer" })).toHaveAttribute("href", "/cases/c1");
    expect(screen.getByRole("button", { name: "Dismiss alert for Acme Corp - Engineer" })).toBeInTheDocument();
  });
});
