import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DecidedFilters } from "../DecidedFilters";
import type { DecidedCase } from "@/lib/db/decidedDays";

function c(over: Partial<DecidedCase>): DecidedCase {
  return {
    caseNumber: "A-1", program: "perm", status: "certified", decidedOn: "2021-03-01",
    receivedOn: null, employerName: "ACME", employerSlug: "acme", jobTitle: "Engineer",
    socCode: "15-1252.00", socTitle: "Software Developers", state: "WA", wage: 120000,
    wageUnit: null, attorneyName: null, attorneySlug: null, worksiteCity: null, naics: null,
    citizenship: null, visaClass: null, education: null, ...over,
  };
}

describe("DecidedFilters", () => {
  it("offers only the fields the loaded rows carry, and names the missing ones", () => {
    render(<DecidedFilters rows={[c({ citizenship: "INDIA" })]} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText("Citizenship")).toBeInTheDocument();
    expect(screen.queryByLabelText("Education")).not.toBeInTheDocument();
    expect(screen.getByText(/Not published for any loaded case: .*education/)).toBeInTheDocument();
  });

  it("reports a choice typed into a long field with the rest of the filters kept", async () => {
    // Arrange
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DecidedFilters
        rows={[c({ citizenship: "INDIA" }), c({ caseNumber: "A-2", citizenship: "CHINA" })]}
        value={{ state: "WA" }}
        onChange={onChange}
      />,
    );
    // Act
    await user.click(screen.getByRole("combobox", { name: "Citizenship" }));
    await user.keyboard("chi{Enter}");
    // Assert
    expect(onChange).toHaveBeenCalledWith({ state: "WA", citizenship: "CHINA" });
  });

  it("lists every firm in the loaded rows, past the 250 a select used to stop at", async () => {
    // Arrange
    const user = userEvent.setup();
    const rows = Array.from({ length: 260 }, (_, i) =>
      c({ caseNumber: `A-${i}`, attorneyName: `Firm ${String(i).padStart(3, "0")}` }),
    );
    render(<DecidedFilters rows={rows} value={{}} onChange={() => {}} />);
    // Act
    await user.click(screen.getByRole("combobox", { name: "Law firm" }));
    await user.keyboard("firm 259");
    // Assert
    expect(screen.getByRole("option", { name: "Firm 259 (1)" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 260 law firms");
  });

  // The filter compares wages as yearly figures (applyDecidedFilters, comparableWage), so the boxes and the note
  // say yearly: "wage at most 60" read as an hourly rate had dropped every hourly row.
  it("says its wage bounds are yearly, as the filter compares them", () => {
    // Arrange, Act
    render(<DecidedFilters rows={[c({})]} value={{}} onChange={() => {}} />);
    // Assert
    expect(screen.getByLabelText("Yearly wage at least")).toBeInTheDocument();
    expect(screen.getByLabelText("Yearly wage at most")).toBeInTheDocument();
    expect(screen.queryByText(/Wages are as filed/)).toBeNull();
    expect(screen.getByText(/an hourly wage counts as its yearly equivalent/)).toBeInTheDocument();
  });
});
