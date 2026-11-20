import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NewUserEmptyState } from "../CasesEmptyStates";

describe("NewUserEmptyState", () => {
  it("offers the import beside adding a case, so cases kept in a spreadsheet come in on day one", () => {
    const onImport = vi.fn();
    render(<NewUserEmptyState onAddCase={() => {}} isAddingCase={false} onImport={onImport} />);
    fireEvent.click(screen.getByRole("button", { name: "Import cases" }));
    expect(onImport).toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /Add (case|your first case)/ }).length).toBeGreaterThan(0);
  });
});
