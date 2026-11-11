import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ShareTimeline } from "../ShareTimeline";

/**
 * The form on a USCIS office's page and on the timelines page. What must hold: it needs no case number; the short
 * form is the office (prefilled), four dates, a category and a country; sharing is the person's own tick; a save
 * sends a 64-hex key it then keeps, and says the timeline waits for review; the edit code is copied or pasted and
 * never put in an address; and nothing renders when there's no backend to post to.
 */

const HAR = "HAR";
const calls: { url: string; body: Record<string, unknown> | null }[] = [];
let mineReply: unknown = null;
let copied: string[] = [];

const el = () => (
  <ShareTimeline office={HAR} sharePath="/i485-by-field-office/hartford-connecticut#timelines" shareLabel="Hartford's timelines" />
);

beforeEach(() => {
  calls.length = 0;
  copied = [];
  mineReply = null;
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  window.localStorage.clear();
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ url, body });
      if (url.includes("/timeline/save")) {
        return new Response(JSON.stringify({ ok: true, status: "pending", message: "Your timeline is saved. It shows on the site once we've checked it, usually within a day." }), { status: 200 });
      }
      if (url.includes("/timeline/remove")) return new Response(JSON.stringify({ ok: true, message: "Your timeline was removed." }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, mine: mineReply }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const saveCall = () => calls.find((c) => c.url.includes("/timeline/save"));

describe("ShareTimeline", () => {
  it("renders nothing when the build has no backend to post to", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    const { container } = render(el());
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("opens with the office picked, the I-485's four dates, a category and a country, and the rest behind a fold", async () => {
    render(el());
    const office = (await screen.findByLabelText("USCIS office handling the I-485")) as HTMLSelectElement;
    expect(office.value).toBe(HAR);
    expect(office.selectedOptions[0]!.textContent).toBe("Hartford, Connecticut");
    for (const name of ["I-485 filed", "Biometrics appointment", "Interview", "Green card approved, or immigrant visa issued", "Category", "Country of chargeability"]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    // EB-1 and waiver cases can be picked here: they have no PERM case.
    const categories = Array.from((screen.getByLabelText("Category") as HTMLSelectElement).options).map((o) => o.value);
    expect(categories).toEqual(["", "eb1", "eb2", "eb2-niw", "eb3", "eb3-other"]);
    expect(screen.getByLabelText("PERM case number, if the case has one").closest("details")!.open).toBe(false);
  });

  it("leaves sharing in the lists to the person: the box starts unticked", async () => {
    render(el());
    expect(await screen.findByRole("checkbox", { name: /show my timeline in the public lists/i })).not.toBeChecked();
  });

  it("refuses to send a timeline with no date, and a case number that isn't a PERM number", async () => {
    render(el());
    fireEvent.click(await screen.findByRole("button", { name: "Save my timeline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least one date/i);
    fireEvent.change(screen.getByLabelText("I-485 filed"), { target: { value: "2025-05-01" } });
    fireEvent.change(screen.getByLabelText("PERM case number, if the case has one"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my timeline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't a PERM case number/i);
    expect(saveCall()).toBeUndefined();
  });

  it("saves with no case number, keeps the key, and says the timeline waits for review", async () => {
    render(el());
    fireEvent.change(await screen.findByLabelText("I-485 filed"), { target: { value: "2025-05-01" } });
    fireEvent.change(screen.getByLabelText("Biometrics appointment"), { target: { value: "2025-06-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my timeline" }));
    await waitFor(() => expect(saveCall()).toBeDefined());
    const sent = saveCall()!.body!;
    expect(sent.key).toMatch(/^[0-9a-f]{64}$/);
    expect("caseNumber" in sent).toBe(false);
    expect(sent).toMatchObject({ fieldOffice: HAR, i485FiledOn: "2025-05-01", biometricsOn: "2025-06-10", public: false });
    expect(await screen.findByText(/Waiting for review/)).toBeInTheDocument();
    expect(screen.getByText(/Your timeline is saved/)).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem("pt-timeline-key")).toBe(sent.key));
    // The key is never in the address.
    expect(window.location.href).not.toContain(sent.key as string);
  });

  it("with a PERM case number, sends it and keeps the key under that case too, so the case's page opens it", async () => {
    render(el());
    fireEvent.change(await screen.findByLabelText("I-485 filed"), { target: { value: "2025-05-01" } });
    fireEvent.change(screen.getByLabelText("PERM case number, if the case has one"), { target: { value: " g-100-25324-425560 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save my timeline" }));
    await waitFor(() => expect(saveCall()).toBeDefined());
    const sent = saveCall()!.body!;
    expect(sent.caseNumber).toBe("G-100-25324-425560");
    await waitFor(() => expect(window.localStorage.getItem("pt-timeline-key:G-100-25324-425560")).toBe(sent.key));
  });

  it("after a save, copies the list's canonical link and the edit code", async () => {
    render(el());
    fireEvent.change(await screen.findByLabelText("I-485 filed"), { target: { value: "2025-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my timeline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy the link to Hartford's timelines" }));
    await waitFor(() => expect(copied).toEqual(["https://permtracker.app/i485-by-field-office/hartford-connecticut#timelines"]));
    fireEvent.click(screen.getByRole("button", { name: "Copy my edit code" }));
    await waitFor(() => expect(copied[1]).toBe(saveCall()!.body!.key));
    expect(await screen.findByRole("button", { name: "Edit code copied" })).toBeInTheDocument();
  });

  it("opens a returning browser's own timeline, with its status and its case number", async () => {
    window.localStorage.setItem("pt-timeline-key", "a".repeat(64));
    mineReply = { input: { fieldOffice: "BOS", i485FiledOn: "2025-05-01", public: true }, caseNumber: "G-100-25324-425560", status: "approved", permFiledOn: null, permCertifiedOn: null };
    render(el());
    expect(await screen.findByText("Your timeline")).toBeInTheDocument();
    expect((screen.getByLabelText("USCIS office handling the I-485") as HTMLSelectElement).value).toBe("BOS");
    expect((screen.getByLabelText("PERM case number, if the case has one") as HTMLInputElement).value).toBe("G-100-25324-425560");
    expect(screen.queryByText(/Waiting for review/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes("/timeline/mine"))!.body).toEqual({ key: "a".repeat(64) });
  });

  it("finds a timeline this browser saved on a case's page before it had a key of its own", async () => {
    window.localStorage.setItem("pt-timeline-key:G-100-25324-425560", "b".repeat(64));
    mineReply = { input: { i140FiledOn: "2025-02-01", public: false }, caseNumber: "G-100-25324-425560", status: "approved", permFiledOn: null, permCertifiedOn: null };
    render(el());
    expect(await screen.findByText("Your timeline")).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes("/timeline/mine"))!.body).toEqual({ key: "b".repeat(64) });
  });

  it("tells the author of a declined timeline what to do", async () => {
    window.localStorage.setItem("pt-timeline-key", "a".repeat(64));
    mineReply = { input: { i485FiledOn: "2025-05-01" }, caseNumber: null, status: "declined", permFiledOn: null, permCertifiedOn: null };
    render(el());
    expect(await screen.findByText(/isn't showing: its dates didn't look right/)).toBeInTheDocument();
  });

  it("opens a timeline from another device by its pasted edit code, and refuses a code that isn't one", async () => {
    render(el());
    const box = await screen.findByLabelText("Saved one on another device? Paste its edit code");
    expect(box.className).toContain("ph-no-capture");
    fireEvent.change(box, { target: { value: "not-a-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(await screen.findByText(/An edit code is 64 letters and digits/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/timeline/mine"))).toBe(false);

    mineReply = { input: { fieldOffice: HAR, i485FiledOn: "2025-05-01" }, caseNumber: null, status: "pending", permFiledOn: null, permCertifiedOn: null };
    fireEvent.change(box, { target: { value: ` ${"C".repeat(64)} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(await screen.findByText("Your timeline")).toBeInTheDocument();
    expect(window.localStorage.getItem("pt-timeline-key")).toBe("c".repeat(64));
  });

  it("says so when a pasted code opens nothing, and keeps no key", async () => {
    render(el());
    fireEvent.change(await screen.findByLabelText("Saved one on another device? Paste its edit code"), { target: { value: "d".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(await screen.findByText(/That code doesn't open a timeline/)).toBeInTheDocument();
    expect(window.localStorage.getItem("pt-timeline-key")).toBeNull();
  });

  it("removes the timeline and forgets its key everywhere it was kept", async () => {
    window.localStorage.setItem("pt-timeline-key", "a".repeat(64));
    window.localStorage.setItem("pt-timeline-key:G-100-25324-425560", "a".repeat(64));
    mineReply = { input: { i485FiledOn: "2025-05-01" }, caseNumber: "G-100-25324-425560", status: "approved", permFiledOn: null, permCertifiedOn: null };
    render(el());
    fireEvent.click(await screen.findByRole("button", { name: "Remove my timeline" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/timeline/remove"))).toBe(true));
    await waitFor(() => expect(window.localStorage.getItem("pt-timeline-key")).toBeNull());
    expect(window.localStorage.getItem("pt-timeline-key:G-100-25324-425560")).toBeNull();
    expect(await screen.findByText("Add your dates")).toBeInTheDocument();
  });

  it("drops the office and the I-485's own dates for a consular case", async () => {
    render(el());
    fireEvent.change(await screen.findByLabelText("After the I-140"), { target: { value: "consular" } });
    expect(screen.queryByLabelText("USCIS office handling the I-485")).toBeNull();
    expect(screen.queryByLabelText("Biometrics appointment")).toBeNull();
    expect(screen.getByLabelText("Interview")).toBeInTheDocument();
  });
});
