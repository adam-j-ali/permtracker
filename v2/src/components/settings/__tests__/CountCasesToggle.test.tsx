import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setCountCaseDates = vi.fn();
let profile: { countCaseDates?: boolean } | null | undefined = {};
vi.mock("convex/react", () => ({
  useQuery: () => profile,
  useMutation: () => setCountCaseDates,
}));
vi.mock("@/lib/contexts/AuthContext", () => ({ useAuthContext: () => ({ isSigningOut: false }) }));
const handleOperationError = vi.fn();
vi.mock("@/lib/errors", () => ({ handleOperationError: (...a: unknown[]) => handleOperationError(...a) }));

const { default: CountCasesToggle } = await import("../CountCasesToggle");

describe("CountCasesToggle", () => {
  beforeEach(() => {
    setCountCaseDates.mockReset();
    handleOperationError.mockReset();
  });

  it("is off unless the account switched it on, and says what's shared and what isn't", () => {
    profile = {};
    render(<CountCasesToggle />);
    const sw = screen.getByRole("switch", { name: "Count my cases in the public figures" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/No name, employer, job, case number or note is shared/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it's handled" })).toHaveAttribute("href", "/privacy#counted-cases");
  });

  it("saves the choice when switched", async () => {
    profile = {};
    setCountCaseDates.mockResolvedValue(null);
    render(<CountCasesToggle />);
    fireEvent.click(screen.getByRole("switch", { name: "Count my cases in the public figures" }));
    await waitFor(() => expect(setCountCaseDates).toHaveBeenCalledWith({ on: true }));
  });

  it("shows on for an account that chose it, and says so when a save fails", async () => {
    profile = { countCaseDates: true };
    setCountCaseDates.mockRejectedValue(new Error("offline"));
    render(<CountCasesToggle />);
    const sw = screen.getByRole("switch", { name: "Count my cases in the public figures" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    await waitFor(() => expect(handleOperationError).toHaveBeenCalled());
  });
});
