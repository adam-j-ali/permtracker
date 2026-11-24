import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ALERT_ROUTES, CHANNEL_WORDS } from "@convex/lib/alertRoutes";

const latest = {
  watch: { down: true, since: 1_796_043_600_000, reason: "the server's disk is 93% full", blips: [] },
  errors: [],
  report: null,
};
vi.mock("convex/react", () => ({ useQuery: () => latest }));

const { AlertRoutesPanel } = await import("../AlertRoutesPanel");

describe("AlertRoutesPanel", () => {
  it("lists every kind in the routing list under its channel, with its latest state", () => {
    render(<AlertRoutesPanel />);
    expect(screen.getByRole("heading", { level: 2, name: "Where each alert goes" })).toBeInTheDocument();
    const phone = screen.getByRole("heading", { level: 3, name: CHANNEL_WORDS.phone }).parentElement!;
    expect(within(phone).getByText("The server's own report says its disk is 90% full or more.")).toBeInTheDocument();
    expect(within(phone).getByText(/On since Mon Nov 30, 8:00 AM EST: the server's disk is 93% full\./)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(ALERT_ROUTES.length);
    const admin = screen.getByRole("heading", { level: 3, name: CHANNEL_WORDS.admin }).parentElement!;
    expect(within(admin).getByText(/Under Attack Mode/)).toBeInTheDocument();
  });
});
