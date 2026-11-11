// @vitest-environment jsdom
/**
 * A case card can be picked up with a mouse.
 *
 * The drag library starts a mouse drag from the card's pointer-down. The card set a pointer-down of its own after
 * spreading the library's, which replaced it: a mouse could never start a drag, though the card showed a grab
 * cursor, and touch and the keyboard (other events) still worked.
 */
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libraryPointerDown = vi.fn();
const libraryKeyDown = vi.fn();
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: { role: "button", tabIndex: 0 },
    listeners: { onPointerDown: libraryPointerDown, onKeyDown: libraryKeyDown },
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock("../CaseCard", () => ({ CaseCard: () => <div>the card</div> }));

const { SortableCaseCard } = await import("../SortableCaseCard");

beforeEach(() => {
  libraryPointerDown.mockClear();
  libraryKeyDown.mockClear();
});

describe("SortableCaseCard", () => {
  it("hands a pointer-down to the drag library, so a mouse can start a drag", () => {
    const { getByText } = render(<SortableCaseCard case={{ _id: "a" } as never} />);
    fireEvent.pointerDown(getByText("the card"));
    expect(libraryPointerDown).toHaveBeenCalledTimes(1);
  });

  it("still hands the keyboard to the drag library", () => {
    const { getByText } = render(<SortableCaseCard case={{ _id: "a" } as never} />);
    fireEvent.keyDown(getByText("the card"), { key: " " });
    expect(libraryKeyDown).toHaveBeenCalledTimes(1);
  });
});
