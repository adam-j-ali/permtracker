import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

const restore = vi.fn();
let listed: unknown = undefined;
vi.mock("convex/react", () => ({
  useQuery: () => listed,
  useMutation: () => restore,
}));
vi.mock("@/lib/contexts/AuthContext", () => ({ useAuthContext: () => ({ isSigningOut: false }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const success = vi.fn();
const error = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => error(...a) } }));
const handleOperationError = vi.fn();
vi.mock("@/lib/errors", () => ({ handleOperationError: (...a: unknown[]) => handleOperationError(...a) }));

const { default: RecentlyDeletedCases } = await import("../RecentlyDeletedCases");

const DAY = 86_400_000;
const deletedAt = Date.UTC(2026, 10, 18, 15);
const entry = (n: number, extra: Record<string, unknown> = {}) => ({
  auditLogId: `log${n}`,
  employerName: `Employer ${n}`,
  positionTitle: "DevOps Engineer",
  beneficiaryIdentifier: null,
  deletedAt,
  restoreBy: deletedAt + 30 * DAY,
  ...extra,
});

describe("RecentlyDeletedCases", () => {
  beforeEach(() => {
    restore.mockReset();
    push.mockReset();
    success.mockReset();
    error.mockReset();
    handleOperationError.mockReset();
  });

  it("says when nothing was deleted in the last 30 days", () => {
    listed = { cases: [], more: false };
    render(<RecentlyDeletedCases />);
    expect(screen.getByRole("heading", { name: "Recently deleted" })).toBeInTheDocument();
    expect(screen.getByText(/You haven’t deleted a case in the last 30 days/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
  });

  it("lists each case by what a person recognises, and says what can't come back", () => {
    listed = { cases: [entry(1, { beneficiaryIdentifier: "J.D." }), entry(2)], more: false };
    render(<RecentlyDeletedCases />);
    expect(screen.getByText("Employer 1")).toBeInTheDocument();
    expect(screen.getByText("DevOps Engineer, J.D.")).toBeInTheDocument();
    expect(screen.getAllByText(/Deleted Nov 18, 2026\. You can restore it until Dec 18, 2026\./)).toHaveLength(2);
    expect(screen.getByText(/documents, its recruitment log and an employer’s FEIN were erased/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Employer 2, DevOps Engineer" })).toBeInTheDocument();
  });

  it("restores one and offers a way to the restored case", async () => {
    listed = { cases: [entry(1)], more: false };
    restore.mockResolvedValue("case123");
    render(<RecentlyDeletedCases />);
    fireEvent.click(screen.getByRole("button", { name: "Restore Employer 1, DevOps Engineer" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith({ auditLogId: "log1" }));
    await waitFor(() => expect(success).toHaveBeenCalled());
    const [message, options] = success.mock.calls[0] as [string, { description: string; action: { label: string; onClick: () => void } }];
    expect(message).toBe("Case restored");
    expect(options.description).toBe("Employer 1, DevOps Engineer is back in your cases.");
    expect(options.action.label).toBe("Open case");
    options.action.onClick();
    expect(push).toHaveBeenCalledWith("/cases/case123");
  });

  it("shows the server's reason when a restore is refused, and a plain one otherwise", async () => {
    listed = { cases: [entry(1)], more: false };
    restore.mockRejectedValueOnce(new ConvexError("That case was restored already. You'll find it in your cases."));
    render(<RecentlyDeletedCases />);
    fireEvent.click(screen.getByRole("button", { name: /Restore Employer 1/ }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("That case was restored already. You'll find it in your cases."));
    restore.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: /Restore Employer 1/ }));
    await waitFor(() => expect(handleOperationError).toHaveBeenCalled());
    expect(handleOperationError.mock.calls[0]![1]).toMatchObject({ userMessage: "Couldn’t restore the case. Try again." });
  });

  it("pages a long list and says when there are more than it holds", () => {
    listed = { cases: Array.from({ length: 30 }, (_, i) => entry(i + 1)), more: true };
    render(<RecentlyDeletedCases />);
    expect(screen.getAllByRole("button", { name: /^Restore Employer/ }).length).toBeLessThan(30);
    expect(screen.getByRole("navigation", { name: "Pages of deleted cases" })).toBeInTheDocument();
    expect(screen.getByText(/the 30 most recently deleted/)).toBeInTheDocument();
  });
});
