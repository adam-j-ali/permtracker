// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The calendar with nothing on it still shows its heading and its filter row,
 * and every empty state has a way out. Before, hiding the last visible case
 * (one tap on "Hide from Calendar") or closing every case left a page with a
 * message and no control: the filters that undo either weren't rendered.
 */
const state = vi.hoisted(() => ({
  cases: [] as Record<string, unknown>[],
  preferences: { hiddenCases: [] as string[], hiddenDeadlineTypes: [] as string[] },
  eventArgs: [] as { showCompleted: boolean; showClosed: boolean }[],
  save: vi.fn(),
  push: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args?: { showCompleted: boolean; showClosed: boolean }) => {
    if (ref === "calendar:getCalendarEvents") {
      if (args) state.eventArgs.push(args);
      return state.cases;
    }
    if (ref === "calendar:getCalendarPreferences") return state.preferences;
    return { googleCalendarConnected: true };
  },
  useMutation: () => state.save,
}));
vi.mock("@convex/_generated/api", () => ({
  api: {
    calendar: {
      getCalendarEvents: "calendar:getCalendarEvents",
      getCalendarPreferences: "calendar:getCalendarPreferences",
      updateCalendarPreferences: "calendar:updateCalendarPreferences",
    },
    users: { currentUserProfile: "users:currentUserProfile" },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/app/calendar.css", () => ({}));
vi.mock("@/components/calendar", () => ({
  CalendarView: ({ events }: { events: unknown[] }) => <div data-testid="calendar-view">{events.length} events</div>,
  CalendarFilters: () => <div data-testid="calendar-filters">filters</div>,
}));
vi.mock("@/components/cases/CaseCapNotice", () => ({ CaseCapNotice: () => null }));
vi.mock("@/lib/errors", () => ({ handleOperationError: vi.fn() }));

import { CalendarPageClient } from "../CalendarPageClient";

const openCase = {
  id: "case-1",
  employerName: "Acme Corp",
  beneficiaryIdentifier: "A. Person",
  positionTitle: "Engineer",
  caseStatus: "pwd",
  progressStatus: "working",
  pwdExpirationDate: "2027-06-30",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.cases = [];
  state.preferences = { hiddenCases: [], hiddenDeadlineTypes: [] };
  state.eventArgs = [];
  state.save.mockResolvedValue(null);
});

describe("the calendar with nothing on it", () => {
  it("keeps the filters and offers 'Show everything' when the person's own filters hide it all", () => {
    state.cases = [openCase];
    state.preferences = { hiddenCases: ["case-1"], hiddenDeadlineTypes: [] };
    render(<CalendarPageClient />);

    expect(screen.getByTestId("calendar-filters")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Everything is hidden" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(state.save).toHaveBeenCalledWith({ hiddenCases: [], hiddenDeadlineTypes: [] });
  });

  it("keeps the filters and offers closed and completed cases when no open case answers", () => {
    render(<CalendarPageClient />);

    expect(screen.getByTestId("calendar-filters")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No open deadlines" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show closed and completed cases" }));
    expect(state.eventArgs.at(-1)).toEqual({ showCompleted: true, showClosed: true });

    // Still nothing with every case asked for: the account has none.
    expect(screen.getByRole("heading", { name: "No cases yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add your first case/ }));
    expect(state.push).toHaveBeenCalledWith("/cases/new");
  });

  it("says so when the cases simply have no dates", () => {
    state.cases = [{ ...openCase, pwdExpirationDate: undefined }];
    render(<CalendarPageClient />);

    expect(screen.getByTestId("calendar-filters")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No dates yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show everything" })).toBeNull();
  });
});

describe("the calendar with deadlines", () => {
  it("draws the calendar under the same heading and filters", () => {
    state.cases = [openCase];
    render(<CalendarPageClient />);

    expect(screen.getByTestId("calendar-filters")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-view")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /hidden|No / })).toBeNull();
  });
});
