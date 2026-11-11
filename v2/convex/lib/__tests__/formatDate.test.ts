import { describe, expect, it } from "vitest";

import { formatDateForNotification } from "../formatDate";

describe("the date printed in an account email", () => {
  // 9:00 PM Eastern on Nov 10 is already Nov 11 in UTC, the server's zone.
  const evening = Date.UTC(2026, 10, 11, 2, 0, 0);

  it("is the Eastern day, in the evening too", () => {
    expect(formatDateForNotification(evening)).toBe("November 10, 2026");
    expect(formatDateForNotification(evening, true)).toBe("Tuesday, November 10, 2026");
  });

  it("takes a Date as well as a timestamp", () => {
    expect(formatDateForNotification(new Date(Date.UTC(2026, 6, 4, 16, 0, 0)))).toBe("July 4, 2026");
  });
});
