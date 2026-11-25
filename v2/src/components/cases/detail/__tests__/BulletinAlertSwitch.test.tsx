import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

const setAlert = vi.fn();
const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => setAlert,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BulletinAlertSwitch } from "../BulletinAlertSwitch";

const CASE_ID = "k577zsgc2hqkypgjp070hhnh458g4dyg" as Id<"cases">;

beforeEach(() => {
  setAlert.mockReset();
  useQueryMock.mockReset();
});

describe("BulletinAlertSwitch", () => {
  it("offers the alert for the case's line, off until asked", () => {
    useQueryMock.mockReturnValue({ line: { category: "EB2", country: "india" }, state: "off" });
    render(<BulletinAlertSwitch caseId={CASE_ID} />);
    const toggle = screen.getByRole("switch", { name: "Email me when this line moves" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("turns it on through the case's own alert, and says where the email goes", async () => {
    useQueryMock.mockReturnValue({ line: { category: "EB2", country: "india" }, state: "off" });
    setAlert.mockResolvedValue({ state: "on", message: "We'll email you when this line moves in a new bulletin." });
    render(<BulletinAlertSwitch caseId={CASE_ID} />);
    fireEvent.click(screen.getByRole("switch", { name: "Email me when this line moves" }));
    await waitFor(() => expect(setAlert).toHaveBeenCalledWith({ caseId: CASE_ID, enabled: true }));
  });

  it("says a confirmation is waiting in the inbox", () => {
    useQueryMock.mockReturnValue({ line: { category: "EB2", country: "india" }, state: "pending" });
    render(<BulletinAlertSwitch caseId={CASE_ID} />);
    expect(screen.getByText(/Check your inbox to confirm/)).toBeInTheDocument();
  });

  it("shows nothing until the case names a line", () => {
    useQueryMock.mockReturnValue({ line: null, state: "off" });
    const { container } = render(<BulletinAlertSwitch caseId={CASE_ID} />);
    expect(container).toBeEmptyDOMElement();
  });
});
