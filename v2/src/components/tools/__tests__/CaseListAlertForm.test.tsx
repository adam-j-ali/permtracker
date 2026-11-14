import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/convexSite", () => ({ convexSiteUrl: (path: string) => `https://example.convex.site${path}` }));

import { CaseListAlertForm } from "../CaseListAlertForm";
import { CASES_PER_ADDRESS } from "@/lib/caseList";
import { easternDay } from "@/lib/time";

const A = "G-100-26125-868956";
const B = "G-100-26130-111111";
const WAGE = "P-100-26131-222222";

function reply(ok: boolean, message: string, extra: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 400, json: async () => ({ ok, message, ...extra }) });
}

const box = () => screen.getByLabelText("Case numbers");
const paste = (text: string) => fireEvent.change(box(), { target: { value: text } });
const readLine = () => screen.getByRole("status");

async function send(address = "mobility@example.com") {
  fireEvent.change(screen.getByLabelText("Your email address"), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Email me their changes" }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the box for a list of case numbers", () => {
  it("starts at zero and says what to expect", () => {
    render(<CaseListAlertForm source="alerts-page" />);

    expect(readLine()).toHaveTextContent("0 case numbers read");
    expect(screen.getByText(/One email then names them all, each with DOL's status, and one click confirms the list\./)).toBeInTheDocument();
    // And a picture of the outcome: the email's list, labelled as an example, one row per state it can show.
    expect(screen.getByText("An example of the email's list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.trim())).toEqual([
      "G-100-26125-868956 Analyst Review",
      "G-100-26130-111111 Certified",
      "P-100-26131-222222 Not in our records yet",
    ]);
  });

  it("swaps the example for the reader's own numbers once there are any", () => {
    render(<CaseListAlertForm source="alerts-page" />);
    paste(B);
    expect(screen.queryByText("An example of the email's list")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("puts what was read before the email box and the button, so it's seen before sending", () => {
    render(<CaseListAlertForm source="alerts-page" />);
    const order = (el: Element) => el.compareDocumentPosition(readLine()) & Node.DOCUMENT_POSITION_PRECEDING;
    expect(order(screen.getByLabelText("Your email address"))).toBeTruthy();
    expect(order(screen.getByRole("button", { name: "Email me their changes" }))).toBeTruthy();
  });

  it("counts what it reads as it's pasted, and lists each number as it'll be sent", () => {
    render(<CaseListAlertForm source="alerts-page" />);

    paste(`${A.toLowerCase()}\n${B}, ${WAGE}`);

    expect(readLine()).toHaveTextContent("3 case numbers read");
    for (const number of [A, B, WAGE]) expect(screen.getByText(number)).toBeInTheDocument();
  });

  it("says one, not ones, for a single number", () => {
    render(<CaseListAlertForm source="alerts-page" />);
    paste(A);
    expect(readLine()).toHaveTextContent("1 case number read");
  });

  it("shows a line it can't read, so a typo is seen before anything is sent", () => {
    render(<CaseListAlertForm source="alerts-page" />);

    paste(`${A}\nG-100-2612-868956`);

    expect(screen.getByText("1 line has no case number we can read:")).toBeInTheDocument();
    expect(screen.getByText("G-100-2612-868956")).toBeInTheDocument();
    expect(readLine()).toHaveTextContent("Something below needs a look.");
  });

  it("lists the first few of a long list and counts the rest", () => {
    render(<CaseListAlertForm source="alerts-page" />);
    const numbers = Array.from({ length: 12 }, (_, i) => `G-100-26125-${500000 + i}`);

    paste(numbers.join("\n"));

    expect(readLine()).toHaveTextContent("12 case numbers read");
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("and 4 more, all named in the email")).toBeInTheDocument();
  });

  it("says a repeat was counted once", () => {
    render(<CaseListAlertForm source="alerts-page" />);
    paste(`${A}\n${A}`);
    expect(readLine()).toHaveTextContent("1 case number read");
    expect(screen.getByText("1 repeat was counted once.")).toBeInTheDocument();
  });

  it("sends the numbers as read, each once, with the address", async () => {
    const fetchMock = reply(true, "We read 2 case numbers. Check your inbox to confirm.");
    vi.stubGlobal("fetch", fetchMock);
    render(<CaseListAlertForm source="alerts-page" />);
    paste(`Sample Worker\t${A.toLowerCase()}\t2025-04-10\n${B}\n${B}\nnot a number`);

    await send();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.convex.site/case-alert/subscribe-list");
    expect(JSON.parse(init.body)).toEqual({ email: "mobility@example.com", caseNumbers: [A, B], source: "alerts-page-list" });
  });

  it("shows the server's own words once it's sent, and remembers each case as asked", async () => {
    vi.stubGlobal("fetch", reply(true, "We read 2 case numbers. Check your inbox to confirm."));
    render(<CaseListAlertForm source="alerts-page" />);
    paste(`${A}\n${B}`);

    await send();

    await waitFor(() => expect(screen.getByText("We read 2 case numbers. Check your inbox to confirm.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Case numbers")).toBeNull();
    expect(window.localStorage.getItem(`pt-watch:${A}`)).toBe(easternDay());
    expect(window.localStorage.getItem(`pt-watch:${B}`)).toBe(easternDay());
  });

  it("shows a refusal in the server's words, keeps the list, and remembers nothing", async () => {
    vi.stubGlobal("fetch", reply(false, "That email address doesn't look right."));
    render(<CaseListAlertForm source="alerts-page" />);
    paste(`${A}\n${B}`);

    // An address the browser lets through (its own check stops a malformed one before our code runs).
    await send("someone@example.invalid");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That email address doesn't look right."));
    expect(box()).toHaveValue(`${A}\n${B}`);
    expect(window.localStorage.getItem(`pt-watch:${A}`)).toBeNull();
  });

  it("asks for a number before it asks the server for anything", async () => {
    const fetchMock = reply(true, "unused");
    vi.stubGlobal("fetch", fetchMock);
    render(<CaseListAlertForm source="alerts-page" />);
    paste("just some words");

    await send();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Paste at least one case number first.");
  });

  it("sends the first hundred of a longer list, and says the rest stay behind", async () => {
    const fetchMock = reply(true, "ok");
    vi.stubGlobal("fetch", fetchMock);
    render(<CaseListAlertForm source="alerts-page" />);
    const numbers = Array.from({ length: CASES_PER_ADDRESS + 7 }, (_, i) => `G-100-26125-${500000 + i}`);
    paste(numbers.join("\n"));

    expect(screen.getByText(/the first 100 go and 7 stay\s+behind/)).toBeInTheDocument();
    await send();

    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body).caseNumbers as string[];
    expect(sent).toEqual(numbers.slice(0, CASES_PER_ADDRESS));
  });

  it("says the email is queued when the server says so", async () => {
    vi.stubGlobal("fetch", reply(true, "It goes out on its own, usually within minutes.", { queued: true }));
    render(<CaseListAlertForm source="alerts-page" />);
    paste(A);

    await send();

    await waitFor(() => expect(screen.getByText(/Confirm it when it arrives\./)).toBeInTheDocument());
  });

  it("says the connection dropped when the request never lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<CaseListAlertForm source="alerts-page" />);
    paste(A);

    await send();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("the connection dropped"));
  });

  it("reads the count out as one line, never the whole list", () => {
    render(<CaseListAlertForm source="alerts-page" />);
    paste(`${A}\n${B}`);

    const live = readLine();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(within(live).queryByText(A)).toBeNull();
    expect(box()).toHaveAttribute("aria-describedby", live.id);
  });
});
