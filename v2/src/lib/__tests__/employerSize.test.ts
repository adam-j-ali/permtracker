import { describe, expect, it } from "vitest";

import { sizeNote, typicalEmployerSize } from "@/lib/employerSize";

const r = (emp_payroll: unknown, emp_year: unknown = null) => ({ emp_payroll, emp_year });

describe("typicalEmployerSize", () => {
  it("reads past one slip on the newest application (Cloudera's 14 among 784 to 805)", () => {
    const size = typicalEmployerSize([r(14, 2008), r(805, 2008), r(790, 2008), r(784, 2008), r(800, 2008)]);
    expect(size?.employees).toBe(790);
    expect(size?.since).toBe(2008);
    expect(size?.basis).toBe(5);
  });

  it("averages the middle pair of an even count", () => {
    expect(typicalEmployerSize([r(10), r(20), r(30), r(40)])?.employees).toBe(25);
  });

  it("keeps a headcount of 0 as the employer reported it, and leaves out a year before 1700", () => {
    // Arrange, Act: an employer whose filings all say 0 employees on payroll (816 did in fiscal year 2025).
    const none = typicalEmployerSize([r(0, 1066), r("0", "2019"), r(null, 2019)]);
    // Assert
    expect(none).toEqual({ employees: 0, since: 2019, basis: 2 });
  });

  it("lets the middle outvote one 0 among real headcounts", () => {
    expect(typicalEmployerSize([r(0), r(120), r(130)])?.employees).toBe(120);
  });

  it("takes the year most applications give, the newest on a tie", () => {
    expect(typicalEmployerSize([r(5, 2001), r(5, 1998), r(5, 1998), r(5, 2001)])?.since).toBe(2001);
    expect(typicalEmployerSize([r(5, 2001), r(5, 1998), r(5, 1998)])?.since).toBe(1998);
  });

  it("is null when no application gives either", () => {
    expect(typicalEmployerSize([r(null), r(null, 1500), r("many")])).toBeNull();
    expect(typicalEmployerSize([])).toBeNull();
  });

  it("names where the figure comes from", () => {
    expect(sizeNote({ basis: 5, since: 2008 })).toBe("In business since 2008");
    expect(sizeNote({ basis: 5, since: null })).toBe("Typical of its 5 newest filings");
    expect(sizeNote({ basis: 1, since: null })).toBe("On its newest filing");
    expect(sizeNote({ basis: 3, since: 2019, employees: 0 })).toBe("None on payroll, as its filings report it");
  });
});
