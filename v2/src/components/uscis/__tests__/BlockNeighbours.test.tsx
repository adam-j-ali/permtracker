/** The blocks either side as status bars: this block marked, each row opening its block on the chosen form. */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { BlockNeighbours } from "../BlockNeighbours";
import { BLOCK_FORM_EVENT } from "../BlockStatusChooser";
import { blockFormChoices } from "@/lib/uscisSample";

const byForm = (approved: number, waiting: number) => ({
  "I-765": [{ grp: "approved", status: "", n: approved }, { grp: "waiting", status: "", n: waiting }],
  "I-485": [{ grp: "approved", status: "", n: 40 }],
});
const rows = [
  { block: "IOE09374", every: true, choices: blockFormChoices(byForm(500, 500)) },
  { block: "IOE09375", every: true, choices: blockFormChoices(byForm(300, 700)) },
  { block: "IOE09376", every: false, choices: blockFormChoices({ "": [{ grp: "approved", status: "", n: 40 }] }) },
];

describe("BlockNeighbours", () => {
  it("draws each block's bar, marks this one, and says which were checked in full", () => {
    render(<BlockNeighbours block="IOE09375" rows={rows} />);
    const here = screen.getByRole("link", { current: "page" });
    expect(here.textContent).toContain("IOE09375");
    expect(here.textContent).toContain("This block");
    expect(screen.getAllByRole("img").length).toBe(3);
    expect(screen.getByText("40 cases, checked so far")).toBeTruthy();
  });

  it("follows the card's form choice, and opens each block on it", () => {
    render(<BlockNeighbours block="IOE09375" rows={rows} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(BLOCK_FORM_EVENT, { detail: "I-765" }));
    });
    expect(screen.getAllByText("1,000 I-765 cases, every number checked").length).toBe(2);
    expect(screen.getByText("Too few I-765 cases to show")).toBeTruthy();
    const link = screen.getAllByRole("link")[0];
    expect(link?.getAttribute("href")).toBe("/uscis-receipt-blocks/IOE09374#form=I-765");
  });
});
