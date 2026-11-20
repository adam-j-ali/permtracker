import { describe, expect, it } from "vitest";

import { casePriorityDate } from "./priorityDate";

describe("a case's priority date, by 8 CFR 204.5(d)", () => {
  it("is the ETA 9089's filing day when the I-140 rests on a labor certification", () => {
    for (const cat of ["EB-2", "EB-3", undefined]) {
      expect(casePriorityDate({ i140Category: cat, eta9089FilingDate: "2025-03-04", i140FilingDate: "2026-01-10" })).toEqual({
        date: "2025-03-04",
        from: "eta9089",
      });
    }
  });

  it("is the I-140's filing day for EB-1 and a national interest waiver, which need none", () => {
    for (const cat of ["EB-1", "EB-2-NIW"]) {
      expect(casePriorityDate({ i140Category: cat, eta9089FilingDate: "2025-03-04", i140FilingDate: "2026-01-10" })).toEqual({
        date: "2026-01-10",
        from: "i140",
      });
    }
  });

  it("is null until that day is on the case", () => {
    expect(casePriorityDate({ i140Category: "EB-2", i140FilingDate: "2026-01-10" })).toBeNull();
    expect(casePriorityDate({ i140Category: "EB-1", eta9089FilingDate: "2025-03-04" })).toBeNull();
  });
});
