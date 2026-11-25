import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SourceSwitch } from "../SourceSwitch";

vi.mock("@/lib/analytics", () => ({ analytics: { capture: vi.fn() } }));

/** The sources switch (D3): one row of choices that shows every kind of figure or one, by keyboard, and says when a
 *  kind has nothing for this step. It reads and writes ?source= without leaving the page. */

const box = () => document.querySelector("[data-source-view]") as HTMLElement;

function view(kinds: ("official" | "measured" | "community")[]) {
  return render(
    <SourceSwitch kinds={kinds}>
      <div data-source-kind="measured">PERM cases pending at DOL</div>
      <div data-source-kind="community">How long people&apos;s own cases took</div>
    </SourceSwitch>,
  );
}

beforeEach(() => window.history.replaceState(null, "", "/perm-queue"));
afterEach(() => window.history.replaceState(null, "", "/"));

describe("SourceSwitch", () => {
  it("shows every kind at first, with All picked", () => {
    view(["measured", "community"]);
    expect(box().dataset.sourceView).toBe("all");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows one kind on a press, says so, and puts it in the address", () => {
    view(["measured", "community"]);
    fireEvent.click(screen.getByRole("button", { name: "Our count" }));
    expect(box().dataset.sourceView).toBe("ours");
    expect(screen.getByRole("button", { name: "Our count" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status").textContent).toBe("Showing our own count.");
    expect(window.location.search).toBe("?source=ours");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(window.location.search).toBe("");
  });

  it("says when a kind has nothing for this step, rather than showing an empty box", () => {
    view(["measured", "community"]);
    fireEvent.click(screen.getByRole("button", { name: "The agency" }));
    expect(screen.getByText("This box has no figure the agency publishes for this step.")).toBeTruthy();
  });

  it("opens on the view a shared address names", async () => {
    window.history.replaceState(null, "", "/perm-queue?source=people");
    view(["measured", "community"]);
    await act(async () => {});
    expect(box().dataset.sourceView).toBe("people");
  });

  it("offers no switch where the box holds one kind", () => {
    view(["official"]);
    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
  });
});
