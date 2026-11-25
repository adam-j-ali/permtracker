// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../../test-utils/render-utils";

/**
 * The dashboard's list of the email alerts sent to the account's own address: the case status alerts, the receipt
 * alerts and the bulletin alerts a person set up, each with its own way to stop it, read through emailPrefs.mine
 * (the account's proved address, never one the page names).
 */

const mockUseQuery = vi.fn();
const turnOff = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: () => mockUseQuery(),
  useMutation: () => turnOff,
}));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

import MyWatchesWidget from "../MyWatchesWidget";

const STATE = {
  email: "someone@example.com",
  queueAlerts: [],
  caseAlerts: [
    { id: "case1", caseNumber: "G-100-26001-123456", confirmed: true, closed: false, active: true },
    { id: "case2", caseNumber: "G-100-26001-654321", confirmed: false, closed: false, active: false },
  ],
  uscisAlerts: [
    { id: "uscis1", receipt: "IOE0000000012", confirmed: true, active: true, status: null, checkedAt: null, notFound: false },
  ],
  bulletinAlerts: [{ id: "bulletin1", category: "EB2", country: "india", confirmed: true, active: true }],
  employerAlerts: [],
  news: false,
  newsletter: false,
  weeklyDigest: true,
};

describe("MyWatchesWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    turnOff.mockResolvedValue(null);
  });

  it("lists each live alert with a way to stop it", () => {
    mockUseQuery.mockReturnValue(STATE);
    renderWithProviders(<MyWatchesWidget />);
    expect(screen.getByRole("heading", { name: /your email alerts/i })).toBeInTheDocument();
    expect(screen.getByText("G-100-26001-123456")).toBeInTheDocument();
    expect(screen.getByText("IOE0000000012")).toBeInTheDocument();
    expect(screen.getByText("EB2 India")).toBeInTheDocument();
    // An alert never confirmed isn't live, so it isn't listed.
    expect(screen.queryByText("G-100-26001-654321")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^stop /i })).toHaveLength(3);
  });

  it("stops the one asked, through the account's own address", async () => {
    mockUseQuery.mockReturnValue(STATE);
    renderWithProviders(<MyWatchesWidget />);
    await userEvent.click(screen.getByRole("button", { name: /stop the case status alert for G-100-26001-123456/i }));
    await waitFor(() => expect(turnOff).toHaveBeenCalledWith({ kind: "case", id: "case1" }));
  });

  it("leaves out the digests and news, which Settings lists", () => {
    mockUseQuery.mockReturnValue({ ...STATE, news: true, newsletter: true });
    renderWithProviders(<MyWatchesWidget />);
    expect(screen.getAllByRole("button", { name: /^stop /i })).toHaveLength(3);
    expect(screen.getByRole("link", { name: /all your email/i })).toHaveAttribute("href", "/settings?tab=notifications");
  });

  it("shows nothing while loading, signed out, or with no alert on the address", () => {
    for (const value of [undefined, null, { ...STATE, caseAlerts: [], uscisAlerts: [], bulletinAlerts: [] }]) {
      mockUseQuery.mockReturnValue(value);
      const { container, unmount } = renderWithProviders(<MyWatchesWidget />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
