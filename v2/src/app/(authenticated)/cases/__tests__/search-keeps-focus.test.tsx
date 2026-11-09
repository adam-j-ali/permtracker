// @vitest-environment jsdom
/**
 * A search that matches nothing keeps the search box. The page used to swap to an empty state that drew its own
 * filter bar, so the box was a new element and the person typing lost their place mid-word.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@convex/_generated/api";
import { renderWithProviders } from "../../../../../test-utils/render-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/cases",
  useSearchParams: () => new URLSearchParams(),
}));

const CASE = {
  _id: "k577zsgc2hqkypgjp070hhnh458g4dyg",
  _creationTime: 1,
  employerName: "Acme Corp",
  positionTitle: "Software Engineer",
  caseStatus: "pwd",
  progressStatus: "working",
  priorityLevel: "normal",
  isFavorite: false,
  calendarSyncEnabled: true,
  showOnTimeline: true,
  createdAt: 1,
  updatedAt: 1,
};

/**
 * The list query answers by the search: "Acme" finds the one case, anything else finds none. One answer object per
 * search, as Convex keeps one per subscription; a new object every render would never let the page settle.
 */
const answers = new Map<string, unknown>();
function listFor(args: { searchQuery?: string } | undefined) {
  const q = args?.searchQuery ?? "";
  if (!answers.has(q)) {
    const cases = !q || "acme corp".includes(q.toLowerCase()) ? [CASE] : [];
    answers.set(q, {
      cases,
      pagination: { currentPage: 1, totalPages: 1, totalCount: cases.length, pageSize: 12, totalUnfilteredCount: 1, truncated: false },
    });
  }
  return answers.get(q);
}

vi.mock("convex/react", () => ({
  useQuery: (fn: unknown, args: { searchQuery?: string } | undefined) => {
    const name = getFunctionName(fn as never);
    if (name === getFunctionName(api.cases.listFiltered)) return listFor(args);
    if (name === getFunctionName(api.userCaseOrder.getCaseOrder)) return null;
    if (name === getFunctionName(api.googleAuth.isGoogleCalendarConnected)) return false;
    return undefined;
  },
  useMutation: () => mutation,
  useConvex: () => client,
}));
const mutation = vi.fn();
const client = { query: vi.fn() };
vi.mock("@/components/cases/CaseCapNotice", () => ({ CaseCapNotice: () => null }));
// The card's own rendering is tested with the card; here a case only has to show up.
vi.mock("@/components/cases/SortableCaseCard", () => ({
  SortableCaseCard: ({ case: c }: { case: { employerName: string } }) => <div>{c.employerName}</div>,
}));
vi.mock("@/lib/ai/page-context", () => ({ usePageContextUpdater: () => ({ setPageData: vi.fn() }) }));

const { CasesPageClient } = await import("../CasesPageClient");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
});

describe("the cases list's search", () => {
  it("keeps focus in the box when the search empties the list", async () => {
    renderWithProviders(<CasesPageClient />);
    const box = screen.getByRole("searchbox", { name: "Search cases" });
    box.focus();
    fireEvent.change(box, { target: { value: "zzz" } });
    // The search waits 300 ms after the last key, then the list answers with nothing.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getAllByText(/No cases match/i).length).toBeGreaterThan(0);
    const after = screen.getByRole("searchbox", { name: "Search cases" });
    expect(after).toBe(box);
    expect(document.activeElement).toBe(box);
    expect((after as HTMLInputElement).value).toBe("zzz");
    vi.useRealTimers();
  });
});
