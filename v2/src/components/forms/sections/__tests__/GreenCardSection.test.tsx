import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GreenCardSection } from "../GreenCardSection";
import type { CaseFormData } from "@/lib/forms/case-form-schema";

const onChange = vi.fn();
const onDateChange = vi.fn();

beforeEach(() => {
  onChange.mockReset();
  onDateChange.mockReset();
});

/** Text that KeepWhole splits into pieces (it keeps "EB-2" from breaking at its hyphen), matched whole. */
const whole = (text: string) => screen.getAllByText((_, el) => el?.textContent === text)[0]!;

const renderSection = (values: Partial<CaseFormData>) =>
  render(<GreenCardSection values={values} onChange={onChange} onDateChange={onDateChange} />);

describe("GreenCardSection: the adjustment-or-consulate choice", () => {
  it("offers the two paths as a picture of their steps, neither picked yet", () => {
    renderSection({ i140ApprovalDate: "2025-01-02" });
    const group = screen.getByRole("radiogroup", { name: "How the green card is issued" });
    const adjustment = within(group).getByRole("radio", { name: /Adjustment of status in the US/ });
    const consular = within(group).getByRole("radio", { name: /Immigrant visa at a consulate abroad/ });
    expect(adjustment).not.toBeChecked();
    expect(consular).not.toBeChecked();
    // Each path shows its own steps.
    expect(within(group).getAllByText((_, el) => el?.textContent === "Fingerprints").length).toBeGreaterThan(0);
    expect(within(group).getAllByText((_, el) => el?.textContent === "DS-260").length).toBeGreaterThan(0);
  });

  it("records the choice", () => {
    renderSection({});
    fireEvent.click(screen.getByRole("radio", { name: /Immigrant visa at a consulate abroad/ }));
    expect(onChange).toHaveBeenCalledWith("greenCardPath", "consular");
  });

  it("shows the I-485 with the work permit and travel document on the adjustment path, and no consulate steps", () => {
    renderSection({ greenCardPath: "adjustment" });
    expect(screen.getByLabelText("I-485 filed")).toBeInTheDocument();
    expect(screen.getByLabelText("I-485 receipt number")).toBeInTheDocument();
    expect(screen.getByLabelText("I-485 fingerprints (biometrics)")).toBeInTheDocument();
    expect(screen.getByLabelText("Work permit (I-765) filed")).toBeInTheDocument();
    expect(screen.getByLabelText("Travel document (I-131) filed")).toBeInTheDocument();
    expect(screen.queryByLabelText("DS-260 submitted")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Card received")).toBeInTheDocument();
  });

  it("shows the consulate's steps on the consular path", () => {
    renderSection({ greenCardPath: "consular" });
    expect(screen.getByLabelText("National Visa Center case created")).toBeInTheDocument();
    expect(screen.getByLabelText("DS-260 submitted")).toBeInTheDocument();
    expect(screen.getByLabelText("Consular interview")).toBeInTheDocument();
    expect(screen.queryByLabelText("I-485 filed")).not.toBeInTheDocument();
  });

  it("follows the dates when the choice was never made", () => {
    renderSection({ ds260SubmittedDate: "2025-03-01" });
    expect(screen.getByLabelText("DS-260 submitted")).toHaveValue("2025-03-01");
  });

  it("passes a date change on for the stage to follow", () => {
    renderSection({ greenCardPath: "adjustment" });
    fireEvent.change(screen.getByLabelText("I-485 filed"), { target: { value: "2025-01-02" } });
    expect(onChange).toHaveBeenCalledWith("i485FilingDate", "2025-01-02");
    expect(onDateChange).toHaveBeenCalledWith("i485FilingDate", "2025-01-02");
  });
});

describe("GreenCardSection: country of birth and chargeability", () => {
  it("names the bulletin line from the category and the chargeability, which can differ from the birth country", () => {
    renderSection({ ebCategory: "EB-2", countryOfBirth: "IN", chargeabilityCountry: "CA" });
    expect(screen.getByLabelText("Country of birth")).toHaveValue("IN");
    expect(screen.getByLabelText("Chargeability country")).toHaveValue("CA");
    expect(whole("EB-2 Rest of World")).toBeInTheDocument();
  });

  it("charges to the country of birth when no other chargeability is picked", () => {
    renderSection({ ebCategory: "EB-3-other", countryOfBirth: "IN" });
    expect(screen.getByLabelText("Chargeability country")).toHaveValue("");
    expect(whole("EB-3 Other Workers, India")).toBeInTheDocument();
  });

  it("records a country by its code", () => {
    renderSection({});
    fireEvent.change(screen.getByLabelText("Country of birth"), { target: { value: "MX" } });
    expect(onChange).toHaveBeenCalledWith("countryOfBirth", "MX");
  });
});
