import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A search with no match says so, and a failed one says it failed: they had looked the same, an empty box. */

const searchEntities = vi.fn();
vi.mock("@/lib/fetchEntities", () => ({ searchEntities }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/search/DidYouMean", () => ({
  DidYouMean: () => null,
  useNameSuggestions: () => ({ suggestions: [], loading: false }),
}));

const { EmployerComparePicker } = await import("../EmployerComparePicker");

afterEach(() => {
  searchEntities.mockReset();
});

describe("EmployerComparePicker", () => {
  it("says no employer matches when the search found none", async () => {
    searchEntities.mockResolvedValue({ rows: [] });
    render(<EmployerComparePicker a={null} b={null} />);
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "zzqx corp" } });
    expect(await screen.findByText("No employer matches that spelling.", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("says the search failed, never that nothing matched", async () => {
    searchEntities.mockRejectedValue(new Error("503"));
    render(<EmployerComparePicker a={null} b={null} />);
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "acme" } });
    expect(await screen.findByText(/couldn't be searched just now/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText("No employer matches that spelling.")).toBeNull();
  });

  // The picker shows the answer to what's in the box now: a slower answer to an earlier spelling, arriving last,
  // had replaced the right one. Its matches are 44px tap targets.
  it("never lets a slower answer to an earlier spelling replace the current one", async () => {
    // Arrange: each search waits until the test answers it
    const answers = new Map<string, (v: unknown) => void>();
    searchEntities.mockImplementation((_kind: string, q: string) => new Promise((r) => answers.set(q, r)));
    const row = (slug: string, name: string) => ({ slug, name, total: 10, state: "WA" });
    render(<EmployerComparePicker a={null} b={null} />);
    const box = screen.getAllByRole("textbox")[0]!;
    fireEvent.change(box, { target: { value: "ac" } });
    await waitFor(() => expect(answers.has("ac")).toBe(true));
    fireEvent.change(box, { target: { value: "acme" } });
    await waitFor(() => expect(answers.has("acme")).toBe(true));
    // Act: the current spelling answers first, the earlier one last
    answers.get("acme")!({ rows: [row("acme-corp", "Acme Corp")] });
    await screen.findByRole("button", { name: /Acme Corp/ });
    answers.get("ac")!({ rows: [row("ac-labs", "AC Labs")] });
    await new Promise((r) => setTimeout(r, 20));
    // Assert
    expect(screen.queryByRole("button", { name: /AC Labs/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Acme Corp/ }).className).toMatch(/\bmin-h-11\b/);
  });
});
