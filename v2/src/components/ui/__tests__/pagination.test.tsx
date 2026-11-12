import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { clampPage, LIST_SIZE_OPTIONS, NARROW_HIDDEN, pageItems, Pagination, PER_PAGE_OPTIONS, RowsPerPage, useListSize, usePerPage } from "../pagination";

describe("pageItems", () => {
  it("lists every page when there are seven or fewer", () => {
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the first pages together near the start", () => {
    expect(pageItems(2, 12)).toEqual([1, 2, 3, 4, 5, "gap", 12]);
  });

  it("puts the current page between its neighbours in the middle", () => {
    expect(pageItems(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
  });

  it("keeps the last pages together near the end", () => {
    expect(pageItems(11, 12)).toEqual([1, "gap", 8, 9, 10, 11, 12]);
  });

  it("always includes the current page", () => {
    for (let n = 1; n <= 40; n++) for (let p = 1; p <= n; p++) expect(pageItems(p, n)).toContain(p);
  });
});

describe("clampPage", () => {
  it("reads nonsense as page 1 and caps at the last page", () => {
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(2.7, 5)).toBe(2);
  });
});

describe("Pagination", () => {
  it("says which items are showing, marks the current page and moves on a press", () => {
    const onPage = vi.fn();
    render(<Pagination page={2} pageCount={8} onPage={onPage} total={86} perPage={12} noun="guides" />);
    expect(screen.getByText("13 to 24 of 86 guides")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 2, this page" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(onPage).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("turns Previous off on the first page and Next off on the last", () => {
    const { rerender } = render(<Pagination page={1} pageCount={3} onPage={() => {}} />);
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Pagination page={3} pageCount={3} onPage={() => {}} />);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws no controls for a single page", () => {
    render(<Pagination page={1} pageCount={1} onPage={() => {}} total={9} noun="posts" />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("All 9 posts")).toBeTruthy();
  });
});

describe("Pagination's rows per page", () => {
  const per = (now: number, setPer = vi.fn()) => ({ per: now, setPer, options: PER_PAGE_OPTIONS });

  it("offers the sizes, marks the one in use and hands back a pick", () => {
    const setPer = vi.fn();
    render(<Pagination page={1} pageCount={9} onPage={() => {}} total={86} perPage={10} noun="cases" per={per(10, setPer)} />);

    const group = screen.getByRole("group", { name: "Rows per page" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10 rows per page" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "50 rows per page" }));
    expect(setPer).toHaveBeenCalledWith(50);
  });

  it("stays when a bigger page put the whole list on one, so there's a way back", () => {
    render(<Pagination page={1} pageCount={1} onPage={() => {}} total={86} perPage={100} noun="cases" per={per(100)} />);

    expect(screen.getByText("All 86 cases")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10 rows per page" })).toBeInTheDocument();
  });

  it("isn't offered for a list shorter than the smallest page", () => {
    render(<Pagination page={1} pageCount={1} onPage={() => {}} total={9} perPage={10} noun="cases" per={per(10)} />);

    expect(screen.queryByRole("group", { name: "Rows per page" })).toBeNull();
  });
});

describe("usePerPage", () => {
  function Probe(props: Parameters<typeof usePerPage>[0]) {
    const p = usePerPage(props);
    return (
      <div>
        <output data-testid="per">{p.per}</output>
        <output data-testid="chosen">{String(p.chosen)}</output>
        <output data-testid="hide9">{String(p.narrowHidden(9))}</output>
        <output data-testid="hide10">{String(p.narrowHidden(10))}</output>
        <button onClick={() => p.setPer(50)}>fifty</button>
      </div>
    );
  }
  const at = (search: string) => window.history.replaceState(null, "", `/list${search}`);
  const phone = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: matches && q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  afterEach(() => {
    vi.unstubAllGlobals();
    at("");
  });

  it("gives a wide screen the wide page and a phone the short one", () => {
    phone(false);
    const { unmount } = render(<Probe wide={25} narrow={10} />);
    expect(screen.getByTestId("per")).toHaveTextContent("25");
    unmount();

    phone(true);
    render(<Probe wide={25} narrow={10} />);
    expect(screen.getByTestId("per")).toHaveTextContent("10");
    expect(screen.getByTestId("chosen")).toHaveTextContent("false");
  });

  it("hides the rows past the phone's page on a server-rendered list, until someone chooses a size", () => {
    phone(false);
    render(<Probe wide={25} narrow={10} />);

    expect(screen.getByTestId("hide9")).toHaveTextContent("undefined");
    expect(screen.getByTestId("hide10")).toHaveTextContent("max-sm:hidden");
  });

  it("takes the size from the address, on any screen, and hides nothing then", () => {
    phone(true);
    at("?per=50");
    render(<Probe wide={25} narrow={10} />);

    expect(screen.getByTestId("per")).toHaveTextContent("50");
    expect(screen.getByTestId("chosen")).toHaveTextContent("true");
    expect(screen.getByTestId("hide10")).toHaveTextContent("undefined");
  });

  it("ignores a size that isn't offered", () => {
    phone(false);
    at("?per=7");
    render(<Probe wide={25} narrow={10} />);

    expect(screen.getByTestId("per")).toHaveTextContent("25");
  });

  it("writes a pick to the address and starts the list from its first page", () => {
    phone(false);
    at("?page=4&q=acme");
    render(<Probe wide={25} narrow={10} />);

    act(() => fireEvent.click(screen.getByRole("button", { name: "fifty" })));

    expect(window.location.search).toBe("?q=acme&per=50");
    expect(screen.getByTestId("per")).toHaveTextContent("50");
  });
});

describe("useListSize and RowsPerPage, for a list read a page at a time", () => {
  afterEach(() => vi.unstubAllGlobals());
  const screenIs = (narrow: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: narrow && q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));

  function Probe() {
    const list = useListSize();
    return (
      <div>
        <p data-testid="size">{`${list.size} ${list.picked ? "picked" : "default"}`}</p>
        <ul>
          {Array.from({ length: 25 }, (_, i) => (
            <li key={i} className={list.narrowHidden(i)}>{`row ${i + 1}`}</li>
          ))}
        </ul>
        <RowsPerPage list={list} />
      </div>
    );
  }

  it("asks for 25 rows on a wide screen and 10 on a phone", () => {
    screenIs(false);
    const wide = render(<Probe />);
    expect(screen.getByTestId("size").textContent).toBe("25 default");
    wide.unmount();
    screenIs(true);
    render(<Probe />);
    expect(screen.getByTestId("size").textContent).toBe("10 default");
  });

  it("hides the rows of a server-drawn page past the phone's ten, until a size is picked", () => {
    screenIs(false);
    render(<Probe />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[9]!.className).not.toContain(NARROW_HIDDEN);
    expect(rows[10]!.className).toContain(NARROW_HIDDEN);
    fireEvent.click(screen.getByRole("button", { name: "50 rows per page" }));
    expect(screen.getByTestId("size").textContent).toBe("50 picked");
    expect(screen.getAllByRole("listitem")[10]!.className).not.toContain(NARROW_HIDDEN);
  });

  it("offers every size, marks the one in use, and a phone can ask for more", () => {
    screenIs(true);
    render(<Probe />);
    expect(LIST_SIZE_OPTIONS).toEqual([10, 25, 50, 100]);
    for (const n of LIST_SIZE_OPTIONS) expect(screen.getByRole("button", { name: `${n} rows per page` })).toBeDefined();
    expect(screen.getByRole("button", { name: "10 rows per page" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "25 rows per page" }));
    expect(screen.getByTestId("size").textContent).toBe("25 picked");
    expect(screen.getByRole("button", { name: "25 rows per page" }).getAttribute("aria-pressed")).toBe("true");
  });
});
