import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { BlockStatusChooser } from "../BlockStatusChooser";
import { blockFormChoices } from "@/lib/uscisSample";

const choices = blockFormChoices({
  "I-765": [{ grp: "approved", status: "", n: 600 }, { grp: "waiting", status: "", n: 400 }],
  "I-485": [{ grp: "approved", status: "", n: 100 }, { grp: "waiting", status: "", n: 300 }],
});
const lines = { all: "all line", "I-765": "work permit line", "I-485": "green card line" };

afterEach(() => window.history.replaceState(null, "", "/"));

describe("BlockStatusChooser", () => {
  it("opens on every form, with a choice for each form and its count", () => {
    render(<BlockStatusChooser block="IOE09358" asOf="2026-11-27" every choices={choices} lines={lines} />);
    expect(screen.getByRole("button", { name: /All forms/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^I-765.* 1,000$/ })).toBeTruthy();
    expect(screen.getAllByText("1,400").length).toBe(2); // the choice's count and the card's total
    expect(screen.getByText("all line")).toBeTruthy();
  });

  it("shows one form's card and line when it's chosen, and puts the form in the address", () => {
    render(<BlockStatusChooser block="IOE09358" asOf="2026-11-27" every choices={choices} lines={lines} />);
    fireEvent.click(screen.getByRole("button", { name: /^I-765/ }));
    expect(screen.getByRole("button", { name: /^I-765/ }).getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain("Every I-765 case's status in IOE09358");
    expect(screen.getByText("work permit line")).toBeTruthy();
    expect(window.location.hash).toBe("#form=I-765");
    fireEvent.click(screen.getByRole("button", { name: /All forms/ }));
    expect(window.location.hash).toBe("");
  });

  it("opens on the form a shared link names", () => {
    window.history.replaceState(null, "", "/uscis-receipt-blocks/IOE09358#form=i-485");
    render(<BlockStatusChooser block="IOE09358" asOf="2026-11-27" every choices={choices} lines={lines} />);
    expect(screen.getByRole("button", { name: /^I-485/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("green card line")).toBeTruthy();
  });
});

describe("BlockStatusChooser with many forms", () => {
  const many = blockFormChoices(
    Object.fromEntries(["I-765", "I-485", "I-130", "I-129", "I-140", "I-90", "N-400", "I-751"].map((f, i) => [f, [{ grp: "approved", status: "", n: 1000 - i * 100 }]])),
  );
  const manyLines = Object.fromEntries(many.map((c) => [c.key, `${c.key} line`]));

  it("gives every form together and the five commonest a button, and the rest one list", () => {
    render(<BlockStatusChooser block="IOE09377" asOf="2026-11-26" every choices={many} lines={manyLines} />);
    const formButtons = () => within(screen.getByRole("list", { name: /Which form/ })).getAllByRole("button");
    expect(formButtons().length).toBe(6);
    const list = screen.getByRole("combobox", { name: /More forms/ });
    fireEvent.change(list, { target: { value: "N-400" } });
    expect(screen.getByText("N-400 line")).toBeTruthy();
    expect(window.location.hash).toBe("#form=N-400");
    expect(formButtons().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  });
});

describe("BlockStatusChooser on a form decided on another form's receipt", () => {
  // Nov 27 2026: a group read IOE09358's I-485J card (over 99% waiting) as the block's green cards stuck for 9 months.
  // Of 24,493 I-485J receipts checked, none showed an approval; the decision comes on the I-485's receipt.
  const withJ = blockFormChoices({
    "I-485": [{ grp: "approved", status: "", n: 500 }, { grp: "waiting", status: "", n: 500 }],
    "I-485J": [{ grp: "waiting", status: "", n: 90 }],
  });
  it("says so on the I-485J card, and its button shows the I-485 figures", () => {
    render(<BlockStatusChooser block="IOE09358" asOf="2026-11-27" every choices={withJ} lines={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /^I-485J/ }));
    expect(document.body.textContent).toContain("decision comes on the receipt of the I-485 filed with it");
    fireEvent.click(screen.getByRole("button", { name: "Show the I-485 figures" }));
    expect(screen.getByRole("button", { name: /^I-485 / }).getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("decision comes on the receipt of the I-485 filed with it");
  });
  it("says nothing of the kind on a form decided on its own receipt", () => {
    render(<BlockStatusChooser block="IOE09358" asOf="2026-11-27" every choices={withJ} lines={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /^I-485 / }));
    expect(document.body.textContent).not.toContain("The decision comes on the receipt");
  });
});
