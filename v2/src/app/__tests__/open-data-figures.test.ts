import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DATASET_COVERAGE, DATASET_LABELS, datasetKind } from "@/lib/datasetCoverage";
import { CITABLE_FIGURES } from "@/lib/openData";
import { pageName } from "@/lib/siteMap";

/**
 * /open-data's figures to quote (Batch 8): USCIS's own figures, our sample of USCIS's case pages and people's reported
 * timelines, each a dataset the registry dates and a page that shows it. Aggregates only, and no file: the Terms open
 * just the two downloads for reuse as data, so this list must never offer one.
 */
describe("the figures to quote on /open-data", () => {
  it("covers USCIS's own figures, our sample and people's reports", () => {
    const kinds = new Set(CITABLE_FIGURES.map((f) => datasetKind(f.dataset)));
    expect(kinds).toEqual(new Set(["official", "measured", "community"]));
    expect(CITABLE_FIGURES.map((f) => f.dataset)).toEqual(
      expect.arrayContaining(["uscis-sample", "uscis-posted-times", "uscis-form-quarters", "reported-cases"]),
    );
  });

  it("names each by its source line's own name, and links a page the site map names", () => {
    for (const f of CITABLE_FIGURES) {
      expect(DATASET_COVERAGE[f.dataset], f.dataset).toBeDefined();
      expect(DATASET_LABELS[f.dataset], f.dataset).toBeDefined();
      expect(pageName(f.href), f.href).not.toBeNull();
    }
  });

  it("describes totals only: no receipt number, and the sample says it's online filings", () => {
    for (const f of CITABLE_FIGURES) expect(f.what).not.toMatch(/[A-Z]{3}\d{10}/);
    expect(CITABLE_FIGURES.find((f) => f.dataset === "uscis-sample")!.what).toContain("online (IOE) filings");
    expect(CITABLE_FIGURES.find((f) => f.dataset === "reported-cases")!.what).toContain("Self-reported");
  });

  it("offers no download: every link is a page, and the Terms still open only two files", () => {
    for (const f of CITABLE_FIGURES) expect(f.href).not.toMatch(/\.(csv|json)$/);
    const terms = readFileSync("src/app/(site)/(public)/terms/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(terms).toContain("Two files are open for non-commercial use.");
  });
});

describe("/press points reporters at them", () => {
  const press = readFileSync("src/app/(site)/(public)/press/page.tsx", "utf8").replace(/\s+/g, " ");

  it("links the sample, USCIS's figures, people's timelines and the dated list, each with how to credit it", () => {
    for (const href of ["/uscis-receipt-blocks", "/uscis-processing-times", "/green-card-timelines", "/open-data#figures"]) {
      expect(press).toContain(`"${href}"`);
    }
    expect(press).toContain("say it covers online filings only");
    expect(press).toContain("self-reported to PERM Tracker and unchecked");
  });

  it("no longer says its figures are federal records only, now that it offers people's reports", () => {
    expect(press).not.toContain("Federal records only");
  });
});
