import { describe, expect, it } from "vitest";

import { prefsPage } from "../mailPages";

/**
 * The email preferences page when nothing is on for the address: never a bare line. It says what will list here and
 * offers the one next step, in the house's box.
 */
const empty = {
  email: "reader@example.com",
  queueAlerts: [],
  caseAlerts: [],
  bulletinAlerts: [],
  employerAlerts: [],
  news: false,
  newsletter: false,
  weeklyDigest: null,
};

describe("the preferences page with nothing on", () => {
  it("says what will list here, with the one next step, in a box", async () => {
    const html = await prefsPage(empty, "tok").text();
    expect(html).toContain('<div class="empty">');
    expect(html).toContain("Nothing is on for this address right now");
    expect(html).toMatch(/Alerts you turn on at PERM Tracker list here, each with its own Turn off button\./);
    expect(html).toMatch(/<div class="empty">[\s\S]*?<a class="btn go" href="[^"]+\/email-preferences">See what you can get<\/a>/);
    // The box is drawn: an ink edge and a hard offset, on the tint.
    expect(html).toMatch(/\.empty\{[^}]*border:2px solid #000[^}]*\}/);
    expect(html).toMatch(/\.empty\{[^}]*box-shadow:3px 3px 0 #000[^}]*\}/);
  });

  it("keeps the rows and the stop button when something is on", async () => {
    const html = await prefsPage({ ...empty, news: true }, "tok").text();
    expect(html).not.toContain('<div class="empty">');
    expect(html).toContain("Stop everything");
  });
});
