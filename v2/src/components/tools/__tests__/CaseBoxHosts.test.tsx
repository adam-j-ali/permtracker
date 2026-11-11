import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ analytics: { capture: vi.fn() } }));

const { IndexHeader, IndexLookup } = await import("@/components/data/IndexHeader");
const { ProfileHeader } = await import("@/components/entities/ProfileHeader");
const { CaseNextStep } = await import("../CaseNextStep");
// The finder loads when it's first opened: loaded once here, so no wait depends on the first import.
await import("../CaseFinder");

afterEach(cleanup);

/**
 * The boxes that hold the case form. Each is one frame: the no-number part is the box's tinted foot, which only
 * reaches the box's edges if the form is the last thing in a box padded `p-5 sm:p-6`. And a box that is a header's
 * side column opens its finder under the header, at the page's width, never inside itself.
 */
const OPENER = { name: "Find it by employer and filing date" } as const;
const FINDER = { name: "Find your case without the number" } as const;

function footOf(box: HTMLElement): HTMLElement {
  const foot = within(box).getByRole("button", OPENER).closest("div")!;
  expect(foot.className).toMatch(/\bbg-tint\b/);
  return foot;
}

/** The form's wrapper is the box's last child, and the foot is that wrapper's last child: nothing sits under the tint. */
function expectFootAtTheBottom(box: HTMLElement) {
  expect(box.className).toMatch(/(^|\s)p-5(\s|$)/);
  expect(box.className).toMatch(/(^|\s)sm:p-6(\s|$)/);
  const foot = footOf(box);
  expect(box.lastElementChild!.contains(foot)).toBe(true);
  expect(foot.parentElement!.lastElementChild).toBe(foot);
}

describe("the boxes that hold the case form", () => {
  it("a list page's box: the foot at its bottom edge, and the finder under the header", async () => {
    render(
      <IndexHeader
        title="Find an H-2A, H-2B or CW-1 filing"
        lede="Seasonal work."
        aside={<IndexLookup title="Have the number?" example="H-300-26188-123456" source="seasonal-cases" program="seasonal" />}
      />,
    );
    const box = screen.getByText("Have the number?").closest(".object") as HTMLElement;
    expectFootAtTheBottom(box);
    const opener = within(box).getByRole("button", OPENER);
    const panel = document.getElementById(opener.getAttribute("aria-controls") ?? "")!;
    expect(box.contains(panel)).toBe(false);
    // The panel follows the header's two columns, so on a phone it sits right under the box.
    const header = box.closest("header")!;
    expect(header.contains(panel)).toBe(true);
    expect(panel.previousElementSibling!.contains(box)).toBe(true);

    fireEvent.click(opener);
    const finder = await screen.findByRole("region", FINDER);
    expect(panel.contains(finder)).toBe(true);
    expect(box.contains(finder)).toBe(false);
    expect(await screen.findByRole("button", { name: "H-2A, H-2B or CW-1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an employer page's box: its own extra way in sits in the foot, and the finder opens under the header with the name filled in", async () => {
    render(
      <ProfileHeader
        eyebrow="PERM sponsor"
        name="Acme Robotics, Inc."
        aside={
          <CaseNextStep
            question="Waiting on a case with Acme Robotics, Inc.?"
            searchHref="/case-search?q=acme"
            searchLabel="Find it among their filings"
            employerName="Acme Robotics, Inc."
            extra={{ href: "#follow", label: "Follow this employer by email" }}
            source="employer-page"
          />
        }
        figures={<p>figures</p>}
      />,
    );
    const box = screen.getByRole("region", { name: "Check your case" });
    expectFootAtTheBottom(box);
    const foot = footOf(box);
    expect(within(foot).getAllByRole("link").map((a) => a.textContent)).toEqual(["Find it among their filings", "Follow this employer by email"]);

    const opener = within(box).getByRole("button", OPENER);
    const panel = document.getElementById(opener.getAttribute("aria-controls") ?? "")!;
    expect(box.contains(panel)).toBe(false);
    // Under the two columns and above the page's figures.
    expect(panel.nextElementSibling?.textContent).toBe("figures");
    fireEvent.click(opener);
    const finder = await screen.findByRole("region", FINDER);
    expect(panel.contains(finder)).toBe(true);
    expect(await within(finder).findByRole("textbox", { name: "Employer’s name" })).toHaveValue("Acme Robotics, Inc.");
  });

  it("a box standing alone on a page opens its finder flat in its own foot", async () => {
    render(<CaseNextStep question="Waiting on a PERM case?" source="article-end" />);
    const box = screen.getByRole("region", { name: "Check your case" });
    expectFootAtTheBottom(box);
    fireEvent.click(within(box).getByRole("button", OPENER));
    const finder = await screen.findByRole("region", FINDER);
    expect(footOf(box).contains(finder)).toBe(true);
    expect(finder.className).not.toMatch(/\bbg-card\b/);
  });
});
