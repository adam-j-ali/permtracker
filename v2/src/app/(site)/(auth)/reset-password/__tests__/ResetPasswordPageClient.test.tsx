import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * A reset code is sent only with the pass a passed security check returns: the server refuses a reset without
 * one (guardCodeFlows in convex/lib/turnstilePass.ts), so the form has to send it. A refusal says the check
 * expired, never the "we've sent a code" the page shows for an address with no account.
 */

const { signIn, toastError, toastSuccess } = vi.hoisted(() => ({
  signIn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn }) }));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn().mockResolvedValue({ success: true, pass: "one-time-pass" }),
  useMutation: () => vi.fn().mockResolvedValue(null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/reset-password" }));
vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: toastError, warning: vi.fn() },
  updateToastAuthState: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ analytics: { capture: vi.fn() } }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn(), addBreadcrumb: vi.fn() }));
// The real widget loads Cloudflare's script; this one passes the check as soon as it mounts.
vi.mock("@/components/auth/AuthTurnstile", () => ({
  AuthTurnstile: ({ onVerify }: { onVerify: (token: string) => void }) => {
    useEffect(() => onVerify("turnstile-token"), [onVerify]);
    return null;
  },
}));

import { ResetPasswordPageClient } from "../ResetPasswordPageClient";
import { PASS_REFUSED } from "@convex/lib/turnstilePass";

async function requestCode() {
  render(<ResetPasswordPageClient />);
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "person@example.com" } });
  const form = screen.getByLabelText(/^Email/).closest("form")!;
  await waitFor(() => expect(form.querySelector("button[type=submit]")).not.toBeDisabled());
  fireEvent.submit(form);
  await waitFor(() => expect(signIn).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("asking for a reset code", () => {
  it("sends the security check's pass with the request", async () => {
    signIn.mockResolvedValueOnce(undefined);
    await requestCode();
    const formData = signIn.mock.calls[0]![1] as FormData;
    expect(formData.get("flow")).toBe("reset");
    expect(formData.get("turnstilePass")).toBe("one-time-pass");
  });

  it("says the check expired when the server refuses the pass, and never that a code went out", async () => {
    signIn.mockRejectedValueOnce(new Error(`[CONVEX A(auth:signIn)] Uncaught ConvexError: ${PASS_REFUSED}`));
    await requestCode();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]![0]).toMatch(/security check expired/i);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
