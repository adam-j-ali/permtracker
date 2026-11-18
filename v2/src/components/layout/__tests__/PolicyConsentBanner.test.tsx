import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../../test-utils/render-utils";
import PolicyConsentBanner from "../PolicyConsentBanner";

/**
 * The one-line ask after a policy change that affects information already given: hidden at the baseline, shown
 * after a bump, never blocking the page, and gone once accepted.
 */
const mockUseQuery = vi.fn();
const mockAccept = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: () => mockUseQuery(),
  useMutation: () => mockAccept,
}));
vi.mock("@/lib/toast", async (orig) => ({ ...(await orig<typeof import("@/lib/toast")>()), toast: { error: vi.fn(), success: vi.fn() } }));

describe("PolicyConsentBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows nothing at the baseline, or while signed out or loading", () => {
    for (const state of [{ needed: false, version: "2026-11-18" }, null, undefined]) {
      mockUseQuery.mockReturnValue(state);
      const { container, unmount } = renderWithProviders(<PolicyConsentBanner />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("asks once a change needs consent, with a way to read it, and accepts the version it was shown", async () => {
    mockUseQuery.mockReturnValue({ needed: true, version: "2027-02-01" });
    mockAccept.mockResolvedValue({ ok: true });
    renderWithProviders(<PolicyConsentBanner />);
    const region = screen.getByRole("region", { name: "Policy update" });
    expect(region.textContent).toContain("We updated our Privacy Policy and Terms.");
    expect(screen.getByRole("link", { name: "Read what changed" }).getAttribute("href")).toBe("/privacy#changes-to-this-policy");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mockAccept).toHaveBeenCalledWith({ version: "2027-02-01" });
  });

  it("isn't a dialog: the page around it stays usable", () => {
    mockUseQuery.mockReturnValue({ needed: true, version: "2027-02-01" });
    renderWithProviders(<PolicyConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
