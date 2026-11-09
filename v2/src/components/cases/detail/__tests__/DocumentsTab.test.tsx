// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DocumentsTab } from "../DocumentsTab";

/**
 * The documents tab, as a reader uses it: the upload has to hold up in every
 * case (Oct 15 2026). Files wait in a list with their own category
 * until Upload sends them one at a time; a file that fails stays, with the
 * reason, so it can be sent again without choosing it again; delete asks first.
 */
const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });
const chooser = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="file"]')!;

describe("uploading documents", () => {
  it("lists every chosen file and sends each with its own category", async () => {
    const onUpload = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    const { container } = render(<DocumentsTab documents={[]} onUpload={onUpload} />);

    await user.upload(chooser(container), [pdf("offer.pdf"), pdf("ad.pdf")]);
    expect(screen.getByText("offer.pdf")).toBeInTheDocument();
    expect(screen.getByText("ad.pdf")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Category for ad.pdf"), "recruitment");
    await user.click(screen.getByRole("button", { name: "Upload 2 files" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(onUpload.mock.calls.map(([f, cat]) => [f.name, cat])).toEqual([
      ["offer.pdf", "general"],
      ["ad.pdf", "recruitment"],
    ]);
    await waitFor(() => expect(screen.queryByText("offer.pdf")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Upload \d/ })).not.toBeInTheDocument();
  });

  it("keeps a file that failed, with its reason, and lets the one that went up go", async () => {
    const onUpload = vi.fn(async (f: File) => (f.name === "too-big.pdf" ? "That file is over the size limit." : null));
    const user = userEvent.setup();
    const { container } = render(<DocumentsTab documents={[]} onUpload={onUpload} />);

    await user.upload(chooser(container), [pdf("fine.pdf"), pdf("too-big.pdf")]);
    await user.click(screen.getByRole("button", { name: "Upload 2 files" }));

    await waitFor(() => expect(screen.queryByText("fine.pdf")).not.toBeInTheDocument());
    expect(screen.getByText("too-big.pdf")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("That file is over the size limit.");
    expect(screen.getByRole("button", { name: "Upload 1 file" })).toBeEnabled();
  });

  it("lets a waiting file be taken off the list before it's sent", async () => {
    const onUpload = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    const { container } = render(<DocumentsTab documents={[]} onUpload={onUpload} />);

    await user.upload(chooser(container), [pdf("keep.pdf"), pdf("drop.pdf")]);
    await user.click(screen.getByRole("button", { name: "Remove drop.pdf" }));
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload.mock.calls[0]![0].name).toBe("keep.pdf");
  });
});

describe("deleting a document", () => {
  const doc = {
    id: "d1",
    name: "certification.pdf",
    url: "https://example.test/certification.pdf",
    mimeType: "application/pdf",
    size: 2048,
    uploadedAt: 1_790_000_000_000,
    category: "eta9089",
  } as never;

  it("asks first, and deletes only on Delete", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DocumentsTab documents={[doc]} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Delete certification.pdf" }));
    expect(await screen.findByText("Delete this document?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete certification.pdf" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("d1"));
  });
});

describe("paging and opening documents", () => {
  // Fifteen documents: twelve general ones, then three for the PWD.
  const docs = Array.from({ length: 15 }, (_, i) => ({
    id: `d${i + 1}`,
    name: `file-${i + 1}.pdf`,
    url: `https://example.test/file-${i + 1}.pdf`,
    mimeType: "application/pdf",
    size: 1024,
    uploadedAt: 1_790_000_000_000 + i,
    category: i < 12 ? "general" : "pwd",
  })) as never[];

  it("opens a document from the keyboard, by its name", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<DocumentsTab documents={docs} />);
    // Act
    screen.getByRole("button", { name: "file-1.pdf" }).focus();
    await user.keyboard("{Enter}");
    // Assert
    expect(screen.getByRole("button", { name: "Next document" })).toBeInTheDocument();
  });

  it("names the pager's buttons, and pages while a preview is open", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<DocumentsTab documents={docs} />);
    await user.click(screen.getByRole("button", { name: "file-1.pdf" }));
    // Act
    await user.click(screen.getByRole("button", { name: "Next page" }));
    // Assert
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "file-11.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("shows the filter's documents when a filter is picked with a document open", async () => {
    // Arrange: the 14th document is open, on the second page of all fifteen
    const user = userEvent.setup();
    render(<DocumentsTab documents={docs} />);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("button", { name: "file-14.pdf" }));
    // Act: the PWD filter holds three documents, one page
    await user.selectOptions(screen.getByLabelText("Show"), "pwd");
    // Assert
    expect(screen.getByRole("button", { name: "file-13.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "file-14.pdf" })).toBeInTheDocument();
  });
});
