/**
 * datasetSchemaFor: a page's Dataset node from the keys its source line takes. Who made the data (an agency's own
 * table, or this site's compilation) decides the creator and the licence; the page says only what its slice is.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { DATASET_ORIGINS, GOVERNMENT_WORKS, datasetOrigin, datasetSchemaFor, originsMatchKinds } from "@/lib/datasetSchema";
import { checkJsonLd } from "@/lib/seo/jsonLdCheck";
import { getDatasetSchema, SCHEMA_IDS } from "@/lib/structuredData";

const BASE = "https://permtracker.app";
const ROOT = join(__dirname, "..", "..", "..");
const PAGE = {
  name: "USCIS quarterly form performance data",
  description: "Receipts, approvals, denials and median months to a decision for every USCIS form, per fiscal quarter.",
  url: `${BASE}/uscis-processing-times`,
};

describe("datasetSchemaFor", () => {
  it("credits an agency's own table to the agency, under government works, free to read", () => {
    const node = datasetSchemaFor(BASE, ["uscis-form-quarters"], { ...PAGE, dateModified: "2026-06-30" });
    expect(node).toEqual({
      "@context": "https://schema.org",
      "@type": "Dataset",
      ...PAGE,
      dateModified: "2026-06-30",
      isBasedOn: "https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data",
      creator: { "@type": "Organization", name: "U.S. Citizenship and Immigration Services", url: "https://www.uscis.gov" },
      isAccessibleForFree: true,
      license: GOVERNMENT_WORKS,
    });
    expect(checkJsonLd([node])).toEqual([]);
  });

  it("names a place only when the agency's table is about one", () => {
    const office = datasetSchemaFor(BASE, ["uscis-i485-offices"], { ...PAGE, place: "Hartford, Connecticut" });
    expect(office).toMatchObject({ spatialCoverage: { "@type": "Place", name: "Hartford, Connecticut" } });
    expect(datasetSchemaFor(BASE, ["uscis-i485-offices"], PAGE)).not.toHaveProperty("spatialCoverage");
  });

  it("builds a compilation through getDatasetSchema, based on the lead dataset's own source", () => {
    const node = datasetSchemaFor(BASE, ["perm-case-status", "perm-cases"], PAGE);
    expect(node).toEqual(getDatasetSchema(BASE, { ...PAGE, isBasedOn: "https://flag.dol.gov/case-status-search" }));
    expect(node.creator).toEqual({ "@id": SCHEMA_IDS.organization(BASE) });
    expect(checkJsonLd([node])).toEqual([]);
  });

  it("keeps a narrower source page a page names", () => {
    const node = datasetSchemaFor(BASE, ["perm-case-status"], { ...PAGE, isBasedOn: "https://flag.dol.gov/processingtimes" });
    expect(node.isBasedOn).toBe("https://flag.dol.gov/processingtimes");
  });

  it("refuses a dataset whose origin isn't written, so no Dataset names no source", () => {
    expect(() => datasetOrigin(["not-a-dataset"])).toThrow(/No origin is written for the dataset "not-a-dataset"/);
  });

  it("gives an agency as creator only to a dataset whose source kind is official", () => {
    expect(originsMatchKinds()).toEqual([]);
  });
});

/** Every non-test source file under src that calls datasetSchemaFor. */
function callers(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") callers(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && /datasetSchemaFor\s*\(/.test(readFileSync(p, "utf8"))) {
      out.push(p);
    }
  }
  return out;
}

describe("the pages that build a Dataset", () => {
  const files = callers(join(ROOT, "src")).filter((f) => !f.endsWith("src/lib/datasetSchema.ts"));

  it("are found (a scan that sees nothing would pass anything)", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("each lead with a dataset whose origin is written", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const leads = [...src.matchAll(/datasetSchemaFor\(\s*\w+,\s*(?:(\w+)|\[\s*"([^"]+)")/g)].map((m) => {
        if (m[2]) return m[2];
        const list = new RegExp(`const ${m[1]} = \\[\\s*"([^"]+)"`).exec(src);
        return list?.[1] ?? `(${m[1]} isn't a list in this file)`;
      });
      for (const lead of leads) if (!DATASET_ORIGINS[lead]) missing.push(`${relative(ROOT, f)}: ${lead}`);
    }
    expect(missing).toEqual([]);
  });
});
