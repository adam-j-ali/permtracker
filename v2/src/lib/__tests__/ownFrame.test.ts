import { describe, expect, it } from "vitest";

import { inOwnFrame } from "../ownFrame";

type Win = Parameters<typeof inOwnFrame>[0];
const at = (origin: string) => ({ origin }) as Location;

describe("inOwnFrame", () => {
  it("is false for a page opened as a page", () => {
    const win = { location: at("https://permtracker.app") } as { self: unknown; top: unknown; location: Location };
    win.self = win;
    win.top = win;
    expect(inOwnFrame(win as unknown as Win)).toBe(false);
  });

  it("is true for a frame on one of our own pages", () => {
    const top = { location: at("https://permtracker.app") };
    const frame = { top, location: at("https://permtracker.app") } as { self: unknown; top: unknown; location: Location };
    frame.self = frame;
    expect(inOwnFrame(frame as unknown as Win)).toBe(true);
  });

  it("is false for a frame on another site, whose address can't be read", () => {
    const top = {
      get location(): Location {
        throw new DOMException("Blocked a frame with origin", "SecurityError");
      },
    };
    const frame = { top, location: at("https://permtracker.app") } as { self: unknown; top: unknown; location: Location };
    frame.self = frame;
    expect(inOwnFrame(frame as unknown as Win)).toBe(false);
  });

  it("is false for a frame on a readable page at another address", () => {
    const top = { location: at("https://example.com") };
    const frame = { top, location: at("https://permtracker.app") } as { self: unknown; top: unknown; location: Location };
    frame.self = frame;
    expect(inOwnFrame(frame as unknown as Win)).toBe(false);
  });
});
