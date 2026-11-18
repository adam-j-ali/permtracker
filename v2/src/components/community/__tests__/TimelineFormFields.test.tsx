import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ACCOUNT_CODES, I485_CENTERS, type TimelineInput } from "@/lib/communityTimeline";

import { TimelineFormFields } from "../TimelineFormFields";

/**
 * The timeline form's account updates, service center and hints: what a person filling it sees and can do. The rules
 * behind them are convex/lib/communityTimeline.ts's, held by its own tests.
 */

/** The form as the last change left it. */
let last: TimelineInput = {};
const record = (f: TimelineInput): TimelineInput => {
  last = f;
  return f;
};

function Form({ start = { route: "adjustment" } as TimelineInput, variant = "open" as "open" | "case" }) {
  const [form, setForm] = useState<TimelineInput>(start);
  return (
    <TimelineFormFields
      uid="t"
      variant={variant}
      form={form}
      set={(k, v) => setForm((f) => record({ ...f, [k]: v }))}
    />
  );
}

const updates = () => screen.getByRole("group", { name: "Updates in your USCIS account" });

describe("the account updates", () => {
  it("adds an update with a date, a form and a code from the list, all optional but the date", () => {
    render(<Form />);
    fireEvent.click(within(updates()).getByRole("button", { name: "Add an account update" }));
    const first = screen.getByRole("group", { name: "Account update 1" });
    const code = within(first).getByLabelText("Code") as HTMLSelectElement;
    expect([...code.options].map((o) => o.textContent)).toEqual(["No code, only a new date", ...ACCOUNT_CODES, "Other (type the code)"]);
    fireEvent.change(within(first).getByLabelText("Date it showed"), { target: { value: "2026-05-04" } });
    fireEvent.change(within(first).getByLabelText("Form"), { target: { value: "i485" } });
    fireEvent.change(code, { target: { value: "FTA0" } });
    expect(last.accountEvents).toEqual([{ on: "2026-05-04", form: "i485", code: "FTA0" }]);
  });

  it("opens a box to type a code under Other, upper-cased, and closes it when a listed code is picked", () => {
    render(<Form />);
    fireEvent.click(within(updates()).getByRole("button", { name: "Add an account update" }));
    const first = screen.getByRole("group", { name: "Account update 1" });
    fireEvent.change(within(first).getByLabelText("Code"), { target: { value: "__other" } });
    const typed = within(first).getByLabelText("Type the code");
    expect(typed.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.change(typed, { target: { value: "xq7z" } });
    expect(last.accountEvents?.[0]?.code).toBe("XQ7Z");
    fireEvent.change(within(first).getByLabelText("Code"), { target: { value: "IAF" } });
    expect(within(first).queryByLabelText("Type the code")).toBeNull();
    expect(last.accountEvents?.[0]?.code).toBe("IAF");
  });

  it("removes the update its button names, keeping the others and their typed codes", () => {
    render(<Form start={{ route: "adjustment", accountEvents: [{ on: "2026-01-02", code: "IAF" }, { on: "2026-02-03", code: "QZ9" }] }} />);
    expect(within(screen.getByRole("group", { name: "Account update 2" })).getByLabelText("Type the code")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove account update 1" }));
    expect(last.accountEvents).toEqual([{ on: "2026-02-03", code: "QZ9" }]);
    expect(within(screen.getByRole("group", { name: "Account update 1" })).getByLabelText("Type the code")).toBeTruthy();
  });

  it("is on the case page's form too", () => {
    render(<Form variant="case" />);
    expect(within(updates()).getByRole("button", { name: "Add an account update" })).toBeTruthy();
  });
});

describe("the service center and the hints", () => {
  it("offers the six centers beside the office, and none on a consular timeline", () => {
    const { unmount } = render(<Form />);
    const center = screen.getByLabelText("Service center that took in the I-485") as HTMLSelectElement;
    expect([...center.options].slice(1).map((o) => o.value)).toEqual(I485_CENTERS.map((c) => c.id));
    unmount();
    render(<Form start={{ route: "consular" }} />);
    expect(screen.queryByLabelText("Service center that took in the I-485")).toBeNull();
  });

  it("says what's worth adding without blocking anything", () => {
    render(<Form start={{ route: "adjustment", i485FiledOn: "2026-03-02" }} />);
    expect(screen.getByText("Worth adding, if you have it")).toBeTruthy();
    expect(screen.getByText(/The first three letters of your I-485 receipt/)).toBeTruthy();
  });
});

describe("the details and what you did", () => {
  const contacts = () => screen.getByRole("group", { name: "What you did to move the case" });

  it("adds a contact with what was done and its day, and removes it", () => {
    render(<Form />);
    fireEvent.click(within(contacts()).getByRole("button", { name: "Add something you did" }));
    const first = screen.getByRole("group", { name: "Contact 1" });
    fireEvent.change(within(first).getByLabelText("What you did"), { target: { value: "congressional" } });
    fireEvent.change(within(first).getByLabelText("The day"), { target: { value: "2026-08-02" } });
    expect(last.contacts).toEqual([{ on: "2026-08-02", kind: "congressional" }]);
    fireEvent.click(within(first).getByRole("button", { name: "Remove contact 1" }));
    expect(last.contacts).toBeNull();
  });

  it("asks how the interview went, and the move and the card on an adjustment", () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText("The interview"), { target: { value: "waived" } });
    expect(last.interview).toBe("waived");
    fireEvent.change(screen.getByLabelText("Case moved to a field office"), { target: { value: "2026-05-02" } });
    expect(last.officeMovedOn).toBe("2026-05-02");
    expect(screen.getByLabelText("Green card arrived in the mail")).toBeTruthy();
  });

  it("asks the premium request's day only once premium is ticked", () => {
    render(<Form variant="case" />);
    expect(screen.queryByLabelText("Premium processing requested, if it was after filing")).toBeNull();
    fireEvent.click(screen.getByLabelText("The I-140 had premium processing"));
    fireEvent.change(screen.getByLabelText("Premium processing requested, if it was after filing"), { target: { value: "2025-12-01" } });
    expect(last.premiumOn).toBe("2025-12-01");
  });
});
