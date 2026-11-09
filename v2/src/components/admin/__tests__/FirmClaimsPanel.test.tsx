import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/** Revoking a firm's verified claim can take its profile down, so it asks for a second press. */
const revoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => (String(ref).includes("revokeClaim") ? revoke : vi.fn()),
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    firmClaims: {
      approveClaim: "firmClaims:approveClaim",
      rejectClaim: "firmClaims:rejectClaim",
      revokeClaim: "firmClaims:revokeClaim",
      setProfileHidden: "firmClaims:setProfileHidden",
      approveWebsite: "firmClaims:approveWebsite",
      approveEdit: "firmClaims:approveEdit",
      rejectEdit: "firmClaims:rejectEdit",
    },
  },
}));

const { FirmClaimsPanel } = await import("../FirmClaimsPanel");

const claim = {
  _id: "k1",
  slug: "a-law-firm",
  firmName: "A Law Firm",
  status: "verified",
  email: "partner@example.test",
  role: "Partner",
  domain: "example.test",
  domainFilings: 12,
  domainReason: null,
  createdAt: 1_790_000_000_000,
  draft: { website: null, focus: [], languages: [], offices: [], description: null },
  profileHidden: false,
  pendingWebsite: null,
};
const data = { review: [], edits: [], verified: [claim], other: [] } as never;

describe("a verified firm claim", () => {
  it("is revoked only on a second press, and Keep it backs out", async () => {
    // Arrange
    render(<FirmClaimsPanel data={data} />);
    // Act: the first press only asks
    fireEvent.click(screen.getByRole("button", { name: "Revoke the claim" }));
    // Assert
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Revoke the claim" })).toBeInTheDocument();
    // Act: ask again, then confirm
    fireEvent.click(screen.getByRole("button", { name: "Revoke the claim" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke it for good" }));
    // Assert
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ claimId: "k1" }));
  });
});
