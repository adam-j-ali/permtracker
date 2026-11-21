import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PermJobRecord } from "../CaseStatusResult";
import type { PermCaseDetail } from "@/lib/db/permCaseDetail";

const BASE: PermCaseDetail = {
  attorneyName: null,
  attorneySlug: null,
  naics: null,
  worksiteCity: "Seattle",
  jobEducation: null,
  layoff: null,
  pwdNumber: null,
  pwd: null,
  supervised: null,
  olderPwd: null,
};

describe("PermJobRecord: an older case's wage request (sweep item 1)", () => {
  it("prints the request's number, the prevailing wage a year, its level and its dates, as DOL's file gave them", () => {
    render(
      <PermJobRecord
        detail={{ ...BASE, olderPwd: { number: "P10014343361482", wage: 65520, level: "Level III", determined: "2015-01-29", expires: "2015-06-30" } }}
        state="WA"
      />,
    );
    expect(screen.getByText("P10014343361482")).toBeInTheDocument();
    expect(screen.getByText("$65,520 a year")).toBeInTheDocument();
    expect(screen.getByText("Level III")).toBeInTheDocument();
    expect(screen.getByText("Made January 29, 2015, valid until June 30, 2015")).toBeInTheDocument();
    // The older number isn't one the site's case lookup knows, so it isn't a link.
    expect(screen.getByText("P10014343361482").closest("a")).toBeNull();
  });

  it("names a bare level the way the current cases do, and leaves out what the file left blank", () => {
    render(<PermJobRecord detail={{ ...BASE, olderPwd: { number: null, wage: null, level: "II", determined: "2016-03-01", expires: null } }} state={null} />);
    expect(screen.getByText("Level II")).toBeInTheDocument();
    expect(screen.getByText("Made March 1, 2016")).toBeInTheDocument();
    expect(screen.queryByText(/a year/)).toBeNull();
    expect(screen.queryByText("Its wage request")).toBeNull();
  });
});
