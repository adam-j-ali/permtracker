// @vitest-environment jsdom
/**
 * A dropped card stays where it was dropped.
 *
 * The saved order shows only under Sort > "Custom order". A drop made under any other sort saved, said "Order
 * saved", and snapped back, because the list went on showing the other sort. A drop now turns the sort to Custom
 * order, so the list shows what was just saved.
 */
import { act, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@convex/_generated/api";
import { renderWithProviders } from "../../../../../test-utils/render-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/cases",
  useSearchParams: () => new URLSearchParams(),
}));

const base = {
  _creationTime: 1,
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
const FIRST = { ...base, _id: "k577zsgc2hqkypgjp070hhnh458g4dyg", employerName: "Acme Corp" };
const SECOND = { ...base, _id: "k57a3bn0nqfh5zq3v0r6m2x9ph8g5e1c", employerName: "Birch LLC" };
const LIST = {
  cases: [FIRST, SECOND],
  pagination: { currentPage: 1, totalPages: 1, totalCount: 2, pageSize: 12, totalUnfilteredCount: 2, truncated: false },
};

const mutation = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
  useQuery: (fn: unknown) => {
    const name = getFunctionName(fn as never);
    if (name === getFunctionName(api.cases.listFiltered)) return LIST;
    if (name === getFunctionName(api.userCaseOrder.getCaseOrder)) return null;
    if (name === getFunctionName(api.googleAuth.isGoogleCalendarConnected)) return false;
    return undefined;
  },
  useMutation: () => mutation,
  useConvex: () => ({ query: vi.fn() }),
}));

// The drag library's context, kept as a way to drop a card from the test: it hands the page's own drop handler out.
let drop: ((event: unknown) => Promise<void> | void) | undefined;
vi.mock("@dnd-kit/core", async (orig) => ({
  ...(await orig<typeof import("@dnd-kit/core")>()),
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (event: unknown) => void }) => {
    drop = onDragEnd;
    return <>{children}</>;
  },
  DragOverlay: () => null,
}));
vi.mock("@/components/cases/CaseCapNotice", () => ({ CaseCapNotice: () => null }));
vi.mock("@/components/cases/SortableCaseCard", () => ({
  SortableCaseCard: ({ case: c }: { case: { employerName: string } }) => <div>{c.employerName}</div>,
}));
vi.mock("@/lib/ai/page-context", () => ({ usePageContextUpdater: () => ({ setPageData: vi.fn() }) }));

const { CasesPageClient } = await import("../CasesPageClient");

beforeEach(() => {
  localStorage.clear();
  mutation.mockClear();
  drop = undefined;
});

describe("dropping a case card", () => {
  it("saves the new order and turns the sort to Custom order, so the drop holds on screen", async () => {
    renderWithProviders(<CasesPageClient />);
    expect(screen.queryByRole("button", { name: /Custom order/ })).toBeNull();

    await act(async () => {
      await drop?.({ active: { id: FIRST._id }, over: { id: SECOND._id } });
    });

    expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ caseIds: [SECOND._id, FIRST._id] }));
    expect(screen.getByRole("button", { name: /Custom order/ })).toBeTruthy();
  });

  it("changes nothing when the card is dropped where it was", async () => {
    renderWithProviders(<CasesPageClient />);
    await act(async () => {
      await drop?.({ active: { id: FIRST._id }, over: { id: FIRST._id } });
    });
    expect(mutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Custom order/ })).toBeNull();
  });
});
