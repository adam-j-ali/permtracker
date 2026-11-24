import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ArchiveBook, ArchiveLine } from "@/lib/policyArchive";

import { ArchiveYear } from "../ArchiveYear";

/**
 * One folded year of the policy page's long lists. The page sends the year and its count; the lines load the first
 * time a reader opens the year, and show a page at a time.
 */

const line = (i: number): ArchiveLine => [`oflc-${i}`, `Mar ${i}, 2019, OFLC`, `https://www.dol.gov/${i}`, `Announcement ${i}`];
const BOOK: ArchiveBook = { agencies: { "2019": Array.from({ length: 40 }, (_, i) => line(i + 1)) }, decisions: {} };

function open(details: HTMLElement) {
  (details as HTMLDetailsElement).open = true;
  fireEvent(details, new Event("toggle"));
}

describe("ArchiveYear", () => {
  it("sends only the year and its count in the server's HTML", () => {
    const html = renderToStaticMarkup(<ArchiveYear list="agencies" year="2019" count={40} noun="announcement" load={async () => BOOK} />);
    expect(html).toMatch(/<details[^>]*>[\s\S]*<summary[^>]*>[\s\S]*2019[\s\S]*40 announcements/);
    expect(html).not.toContain("Announcement 1");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("asks for nothing until the year is opened", () => {
    const load = vi.fn(async () => BOOK);
    render(<ArchiveYear list="agencies" year="2019" count={40} noun="announcement" load={load} />);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads the year's lines when opened and shows them a page at a time", async () => {
    // Arrange
    const load = vi.fn(async () => BOOK);
    const { container } = render(<ArchiveYear list="agencies" year="2019" count={40} noun="announcement" load={load} />);
    // Act
    await act(async () => open(container.querySelector("details")!));
    // Assert
    expect(load).toHaveBeenCalledTimes(1);
    const titles = () => [...container.querySelectorAll("li.doc-line a")].map((a) => a.textContent);
    expect(titles()).toHaveLength(25);
    expect(titles()[0]).toBe("Announcement 1");
    expect(container.querySelector("li.doc-line a")?.getAttribute("href")).toBe("https://www.dol.gov/1");
    const pages = screen.getByRole("navigation", { name: "Pages of the 2019 announcements" });
    expect(within(pages).getByText("1 to 25 of 40 announcements")).toBeInTheDocument();
    // Act: the next page
    fireEvent.click(within(pages).getByRole("button", { name: "Next page" }));
    // Assert
    expect(titles()).toHaveLength(15);
    expect(titles()[0]).toBe("Announcement 26");
  });

  it("loads a year a reader opened before the page started", async () => {
    // Arrange: the server's HTML, the year opened before scripts ran
    const load = vi.fn(async () => BOOK);
    const ui = <ArchiveYear list="agencies" year="2019" count={40} noun="announcement" load={load} />;
    const host = document.createElement("div");
    // renderToString, as a server render does: it marks the edges between text nodes, which hydration reads.
    host.innerHTML = renderToString(ui);
    document.body.appendChild(host);
    host.querySelector("details")!.open = true;
    // React's development build notes the `open` the reader added, and leaves it, which is the point.
    const noted = vi.spyOn(console, "error").mockImplementation(() => {});
    // Act
    await act(async () => {
      hydrateRoot(host, ui);
    });
    // Assert
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.querySelector("details")!.open).toBe(true);
    expect(host.querySelectorAll("li.doc-line")).toHaveLength(25);
    noted.mockRestore();
    host.remove();
  });

  it("says when the lines couldn't be loaded, and tries again on request", async () => {
    // Arrange
    const load = vi.fn<() => Promise<ArchiveBook>>().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(BOOK);
    const { container } = render(<ArchiveYear list="agencies" year="2019" count={40} noun="announcement" load={load} />);
    // Act
    await act(async () => open(container.querySelector("details")!));
    // Assert
    expect(screen.getByRole("status").textContent).toBe("The 2019 announcements couldn't be loaded just now. Try again");
    // Act: try again
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    // Assert
    expect(load).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("li.doc-line")).toHaveLength(25);
  });

  it("treats a year the file doesn't hold as a failed load rather than an empty year", async () => {
    const { container } = render(<ArchiveYear list="decisions" year="2018" count={3} noun="decision" load={async () => BOOK} />);
    await act(async () => open(container.querySelector("details")!));
    expect(screen.getByRole("status").textContent).toMatch(/The 2018 decisions couldn't be loaded just now\./);
  });

  it("names one of a thing in the singular", () => {
    const html = renderToStaticMarkup(<ArchiveYear list="decisions" year="2018" count={1} noun="decision" load={async () => BOOK} />);
    expect(html).toMatch(/1 decision</);
  });
});
