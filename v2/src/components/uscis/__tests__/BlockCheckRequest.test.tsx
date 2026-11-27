import { describe, expect, it } from "vitest";
import { aboutTime, standingWords } from "../BlockCheckRequest";

const base = { ok: true, votes: 0, doneAt: null, joining: false, position: null, status: null, handed: 0, inLine: 0, running: true, etaMinutes: null };

describe("the block check request's words", () => {
  it("says the place in line and about when, with how many asked", () => {
    expect(standingWords({ ...base, position: 3, status: "waiting", votes: 2, etaMinutes: 150 })).toBe(
      "3rd in line. Done in about 3 hours. 2 people have asked for it.",
    );
  });

  it("says how far a block being checked is", () => {
    expect(standingWords({ ...base, position: 1, status: "walking", handed: 0.39, votes: 1, etaMinutes: 31 })).toBe(
      "Being checked now: 39% of its numbers so far. Done in about 30 minutes. 1 person has asked for it.",
    );
  });

  it("promises no time while checking is paused", () => {
    const words = standingWords({ ...base, position: 2, status: "waiting", running: false });
    expect(words).toBe("2nd in line. Checking is paused right now. Its place in line is kept.");
  });

  it("says a new ask joins the line, and a done block's page updates soon", () => {
    expect(standingWords({ ...base, joining: true, votes: 1 })).toBe("Asked. It joins the line within 10 minutes. 1 person has asked for it.");
    expect(standingWords({ ...base, doneAt: 1 })).toMatch(/^Every number in this block has been checked\./);
    expect(standingWords(base)).toBe("");
  });

  it("rounds times the way people say them", () => {
    expect([aboutTime(3), aboutTime(42), aboutTime(61), aboutTime(600), aboutTime(3000)]).toEqual([
      "about 5 minutes",
      "about 40 minutes",
      "about 1 hour",
      "about 10 hours",
      "about 2 days",
    ]);
  });
});
