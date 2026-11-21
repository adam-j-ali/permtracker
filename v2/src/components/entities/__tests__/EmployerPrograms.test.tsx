import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmployerPrograms } from "../EmployerPrograms";
import type { ProgramLine } from "@/lib/employerPrograms";

/**
 * The employer page's "every program" ledger. Its published counts reach back to FY2008 (DOL's older yearly files
 * added), while its PERM and LCA medians read the newer files only, so each median says which years it covers: a
 * median printed beside an every-year count, unlabelled, would read as every year's.
 */

const line = (program: ProgramLine["program"], over: Partial<ProgramLine> = {}): ProgramLine => ({
  program,
  published: 100,
  pending: 5,
  medianAnnualWage: 120_000,
  wageN: 40,
  ...over,
});

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

describe("EmployerPrograms", () => {
  it("labels the PERM and LCA medians with the years they read", () => {
    const { container } = render(
      <EmployerPrograms
        name="Acme"
        perm={line("perm", { published: 1_340, olderPublished: 1_300, medianFromFy: 2024 })}
        pwd={line("pwd")}
        lca={line("lca", { published: 900, olderPublished: 500, medianFromFy: 2020, wageN: 8 })}
        stages={null}
      />,
    );
    const t = text(container);
    expect(t).toContain("1,340 published");
    expect(t).toContain("of 40, FY2024 on");
    expect(t).toContain("8 wages from FY2020 on, too few");
    // The wage-request median reads every year it has: no year on it.
    expect(t).toMatch(/\$120,000 of 40(?!,)/);
  });

  it("never says none published for an employer whose LCAs are all in the older files", () => {
    const { container } = render(
      <EmployerPrograms
        name="Old Only Corp"
        perm={null}
        pwd={null}
        lca={line("lca", { published: 25, olderPublished: 25, medianFromFy: 2020, wageN: 0, medianAnnualWage: null })}
        stages={null}
      />,
    );
    const t = text(container);
    expect(t).toContain("25 published");
    expect(t).toContain("none from FY2020 on");
    expect(t).not.toContain("none published");
  });

  it("says in its fine print which years the counts and the medians cover, and which visas the LCA line counts", () => {
    const { container } = render(
      <EmployerPrograms
        name="Acme"
        perm={line("perm", { olderPublished: 60, medianFromFy: 2024 })}
        pwd={null}
        lca={line("lca", { olderPublished: 10, medianFromFy: 2020 })}
        stages={null}
      />,
    );
    const t = text(container);
    expect(t).toContain("PERM decisions from FY2008 to FY2023 and the LCAs from FY2008 to FY2019");
    expect(t).toContain("E-3 and H-1B1");
  });
});
