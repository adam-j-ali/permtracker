import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LevelEstimator } from "../LevelEstimator";

const BASIS = {
  ok: true,
  soc: "15-1211",
  wageYear: 2026,
  occupations: [
    { onetCode: "15-1211.00", title: "Computer Systems Analysts", jobZone: 4, education: "bachelor", appendixA: true, usable: true },
    { onetCode: "15-1211.01", title: "Health Informatics Specialists", jobZone: 5, education: "bachelor", appendixA: true, usable: true },
  ],
};

describe("LevelEstimator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("estimates as the requirements change and reports the level to mark on the ladder", async () => {
    // Arrange
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BASIS))));
    const onLevel = vi.fn();
    render(<LevelEstimator soc="15-1211" onLevel={onLevel} />);
    // Act: a Bachelor's with no experience, then 4 years of it.
    await screen.findByText("Level I");
    fireEvent.change(screen.getByLabelText("Months of experience the job requires"), { target: { value: "49" } });
    // Assert
    expect(await screen.findByText("Level IV")).toBeInTheDocument();
    expect(onLevel).toHaveBeenLastCalledWith("IV");
    expect(screen.getByText(/matched DOL's level/)).toBeInTheDocument();
  });

  it("offers the closest occupation when a code holds several, and uses its Job Zone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BASIS))));
    render(<LevelEstimator soc="15-1211" onLevel={() => {}} />);
    const pick = await screen.findByLabelText("Closest occupation");
    fireEvent.change(screen.getByLabelText("Months of experience the job requires"), { target: { value: "30" } });
    expect(await screen.findByText("Level II")).toBeInTheDocument();
    fireEvent.change(pick, { target: { value: "15-1211.01" } });
    // Job Zone 5 starts above 4 years, so 30 months adds nothing.
    expect(await screen.findByText("Level I")).toBeInTheDocument();
  });

  it("says the table couldn't be read rather than estimating from nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, message: "DOL's occupation table couldn't be read just now." }), { status: 502 })));
    const onLevel = vi.fn();
    render(<LevelEstimator soc="15-1211" onLevel={onLevel} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be read");
    expect(onLevel).not.toHaveBeenCalledWith(expect.stringMatching(/I/));
  });

  it("asks for a whole number instead of estimating from a bad one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BASIS))));
    const onLevel = vi.fn();
    render(<LevelEstimator soc="15-1211" onLevel={onLevel} />);
    await screen.findByText("Level I");
    fireEvent.change(screen.getByLabelText("Months of experience the job requires"), { target: { value: "-3" } });
    await waitFor(() => expect(screen.getByText(/whole number from 0 to 600/)).toBeInTheDocument());
    expect(onLevel).toHaveBeenLastCalledWith(null);
  });
});
