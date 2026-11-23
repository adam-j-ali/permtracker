import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The order of /soc-codes and a job title's page. The finder page opens on its search, then the titles, then the
 * groups folded. A title's page opens on the answer beside what to do with the code, then three figures, every
 * code, what each covers, the spellings folded, and it ends on the case box. Nothing a reader used was removed: the
 * Job Zone figure is the answer's note, and "With the code" moved up beside the answer.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

function positions(src: string, marks: string[]): number[] {
  return marks.map((m) => {
    const at = src.indexOf(m);
    expect(at, `not found: ${m}`).toBeGreaterThan(-1);
    return at;
  });
}

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);

describe("a job title's SOC page", () => {
  const src = read("src/app/(site)/(public)/soc-codes/[title]/page.tsx");
  const page = src.slice(src.indexOf("export default async function SocTitlePage"));

  it("opens on the answer beside what to do with the code, then three figures", () => {
    expect(increasing(positions(page, ["<SplitColumns", "With the code", "<h1", "<FigureRow"]))).toBe(true);
    const row = page.slice(page.indexOf("<FigureRow"), page.indexOf("</FigureRow>"));
    expect(row.match(/<Figure\b/g)).toHaveLength(3);
    // The code is the answer, on the dark card; lime is kept for the action.
    expect(row).toContain('tone="ink"');
    expect(row).not.toContain('tone="lime"');
    expect(row).toContain("O*NET Job Zone ${zoneLabelOf(top.zone)} of 5.");
  });

  it("lists every code, then what each covers, folds the spellings, and ends on the case box", () => {
    expect(
      increasing(positions(page, ['id="codes"', "<CodeCards", '<ChapterFold summary="How employers wrote it"', "FAQs", "<SocSources", "<CaseNextStep"])),
    ).toBe(true);
    expect(page.match(/With the code/g)).toHaveLength(1);
  });
});

describe("the SOC code finder", () => {
  const src = read("src/app/(site)/(public)/soc-codes/page.tsx");
  const page = src.slice(src.indexOf("export default async function SocCodesPage"));

  it("opens on its search, then the most filed titles, A to Z, and the groups each folded", () => {
    expect(increasing(positions(page, ["<h1", 'id="soc-finder"', "<SocFinder", 'id="titles"', 'id="title-letters"', 'id="groups"', "FAQs"]))).toBe(true);
    expect(page).toMatch(/groups\.map\(\(g\) => \(\s*<details/);
  });

  it("says what will list when the code list is missing, and points back to the finder", () => {
    expect(page).toMatch(/groups\.length === 0 \? \([\s\S]*?<EmptyState[\s\S]*?href: "#soc-finder"/);
  });
});
