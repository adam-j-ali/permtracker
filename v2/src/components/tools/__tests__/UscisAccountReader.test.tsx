import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UscisAccountReader } from "../UscisAccountReader";

/**
 * The account reader reads a paste in the browser: each case and its updates by date, with what each code is known
 * to mean, receipts masked, and no request of any kind while it reads.
 */
const PASTE = JSON.stringify({
  receiptNumber: "MSC2690012345",
  formType: "I-485",
  submissionDate: "2026-03-02",
  events: [
    { eventCode: "FTA0", eventDateTime: "2026-06-01T15:00:00Z" },
    { eventCode: "QZ9", eventDateTime: "2026-07-01T15:00:00Z" },
  ],
});

let fetchSpy: ReturnType<typeof vi.fn>;
let beaconSpy: ReturnType<typeof vi.fn>;
const realFetch = global.fetch;

beforeEach(() => {
  fetchSpy = vi.fn();
  beaconSpy = vi.fn();
  global.fetch = fetchSpy as unknown as typeof fetch;
  Object.defineProperty(navigator, "sendBeacon", { value: beaconSpy, configurable: true });
});
afterEach(() => {
  global.fetch = realFetch;
});

describe("the USCIS account reader", () => {
  it("reads a paste on the page, with each code's reading and the receipt masked, and sends nothing", () => {
    const { container } = render(<UscisAccountReader />);
    fireEvent.change(screen.getByLabelText("Paste what your USCIS account shows"), { target: { value: PASTE } });
    expect(screen.getByText("2 updates on 1 case")).toBeTruthy();
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("I-485");
    expect(heading.textContent).toContain("MSC••••••2345");
    expect(heading.textContent).toContain("National Benefits Center");
    const items = within(screen.getByRole("list", { name: /^Updates on / })).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("June 1, 2026");
    expect(items[0]!.textContent).toContain("FTA0");
    expect(items[0]!.textContent).toContain("Database checks received");
    expect(items[1]!.textContent).toContain("Not a code we have a reading for");
    // Each code's full reading once, below the list.
    expect(screen.getAllByText(/DATABASE CHECKS RECEIVED/)).toHaveLength(1);
    // Beyond the box the person pasted into, the number never appears whole.
    expect(screen.getByTestId("reading").textContent).not.toContain("2690012345");
    expect(container.textContent).toMatch(/digits\. \d+ updates/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it("is marked so analytics never records the paste or the results", () => {
    const { container } = render(<UscisAccountReader />);
    expect(container.firstElementChild?.className).toContain("ph-no-capture");
    expect(screen.getByLabelText("Paste what your USCIS account shows").className).toContain("ph-no-capture");
  });

  it("says it found nothing rather than guessing", () => {
    render(<UscisAccountReader />);
    fireEvent.change(screen.getByLabelText("Paste what your USCIS account shows"), { target: { value: "still waiting, no news" } });
    expect(screen.getByText(/No updates found in that/)).toBeTruthy();
  });
});
