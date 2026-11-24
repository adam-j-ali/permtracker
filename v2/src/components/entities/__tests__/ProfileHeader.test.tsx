import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileHeader, type ProfileTag } from "../ProfileHeader";

/**
 * The top of an employer, firm or job page. On a phone the case box comes straight after the name and its answer
 * line (it used to start below the first screen, after the tags and four facts); beside the name on a wide screen.
 * A hold, an appeal or a debarment keeps its box; the rest of what's on record is one plain line of links.
 */

const TAGS: ProfileTag[] = [
  { text: "12 on hold since Oct 8", href: "#now", tone: "warn" },
  { text: "On DOL's debarment list", href: "#debarment", tone: "bad" },
  { text: "1 layoff notice", href: "#layoffs", tone: "ink" },
  { text: "2 OSHA inspections with violations", href: "#safety-inspections", tone: "ink" },
];

const header = (tags: ProfileTag[] = TAGS, recordLead?: string) =>
  render(
    <ProfileHeader
      eyebrow="PERM sponsor"
      name="MERIT LOGISTICS"
      answer="Sponsors green cards: 412 PERM cases filed in the last 12 months."
      tags={tags}
      recordLead={recordLead}
      facts={[{ label: "Main job", value: "Heavy and Tractor-Trailer Truck Drivers" }]}
      aside={<section aria-label="Check your case">case box</section>}
      figures={<p>figures</p>}
    />,
  );

/** Whether `a` comes before `b` in the page, the order a phone shows them in and a screen reader reads them. */
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("ProfileHeader", () => {
  it("puts the case box right after the name and the answer line, before the tags and facts", () => {
    header();
    const name = screen.getByRole("heading", { level: 1, name: "MERIT LOGISTICS" });
    const answer = screen.getByText(/Sponsors green cards/);
    const box = screen.getByRole("region", { name: "Check your case" });
    const stands = screen.getByRole("list", { name: "What stands out now" });
    const fact = screen.getByText("Main job");
    expect(before(name, answer)).toBe(true);
    expect(before(answer, box)).toBe(true);
    expect(before(box, stands)).toBe(true);
    expect(before(box, fact)).toBe(true);
  });

  it("sets the case box beside the name in its own column on a wide header, beside both rows", () => {
    header();
    const cell = screen.getByRole("region", { name: "Check your case" }).parentElement!;
    expect(cell.className.split(" ")).toEqual(
      expect.arrayContaining(["@[52rem]:col-start-2", "@[52rem]:row-span-2", "@[52rem]:row-start-1"]),
    );
    const grid = cell.parentElement!;
    // The second row takes the spare height, so the tags sit under the name with no gap the box's height opened.
    expect(grid.className).toContain("@[52rem]:grid-rows-[auto_1fr]");
  });

  it("sets the figures beside the case box when nothing else sits under the name, so the box opens no empty gap", () => {
    render(
      <ProfileHeader
        eyebrow="PERM by worksite city"
        name="PERM jobs in New York, NY"
        answer="73,863 PERM decisions name New York, NY as the worksite."
        aside={<section aria-label="Check your case">case box</section>}
        figures={<p>the figures</p>}
      />,
    );
    const cell = screen.getByText("the figures").parentElement!;
    expect(cell.className.split(" ")).toEqual(expect.arrayContaining(["@[52rem]:col-start-1", "@[52rem]:row-start-2"]));
    // In the grid beside the box, not under the whole header.
    expect(cell.parentElement).toBe(screen.getByRole("region", { name: "Check your case" }).parentElement!.parentElement);
  });

  it("keeps the figures under the whole header when tags or facts sit under the name", () => {
    header();
    const cell = screen.getByText("figures").parentElement!;
    expect(cell.className).toContain("mt-8");
    expect(cell.className).not.toContain("@[52rem]:row-start-2");
  });

  it("keeps a hold, an appeal or a debarment in its box, and only those", () => {
    header();
    const boxes = within(screen.getByRole("list", { name: "What stands out now" })).getAllByRole("link");
    expect(boxes.map((a) => a.textContent)).toEqual(["12 on hold since Oct 8", "On DOL's debarment list"]);
  });

  it("puts the rest of the record on one plain line of links, each to where it's shown in full", () => {
    header();
    const line = screen.getByText("On record:").closest("p")!;
    expect(line.textContent).toBe("On record: 1 layoff notice · 2 OSHA inspections with violations");
    const links = within(line).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#layoffs", "#safety-inspections"]);
    // A link alone on a phone's line still gets the 44px floor.
    for (const a of links) expect(a.className.split(" ")).toEqual(expect.arrayContaining(["max-sm:min-h-11", "max-sm:inline-flex"]));
  });

  it("leads the line with the page's own words, and draws no empty box or line", () => {
    header([{ text: "1,240 H-1B LCAs", href: "#programs", tone: "ink" }], "Also on this page");
    expect(screen.getByText("Also on this page:").closest("p")?.textContent).toBe("Also on this page: 1,240 H-1B LCAs");
    expect(screen.queryByRole("list", { name: "What stands out now" })).toBeNull();
    header([]);
    expect(screen.queryByText(/On record:/)).toBeNull();
  });
});

describe("the header's note", () => {
  it("shows the note under the answer line, in the header", () => {
    render(
      <ProfileHeader eyebrow="PERM sponsor" name="MERIT LOGISTICS" answer="Nothing waiting at DOL now."
        note="These are past filings." />,
    );
    const note = screen.getByText("These are past filings.");
    expect(note.closest("header")).not.toBeNull();
    expect(note.compareDocumentPosition(screen.getByText("Nothing waiting at DOL now.")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
