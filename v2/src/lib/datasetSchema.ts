/**
 * A page's Dataset JSON-LD, built from the same dataset keys its source line takes (`DataProvenance`), so the
 * structured data and the line a reader sees name one source.
 *
 * Each key's origin is written once, below: the agency page its records come from, and, for a table an agency
 * publishes that the page prints as published, the agency itself. Who made a dataset decides two fields:
 *
 * - an agency's own table (its source kind is official, src/lib/datasetCoverage.ts): the agency is the creator, as a
 *   bare Organization (Google's Dataset parser matches the type literally and rejected GovernmentOrganization on
 *   /perm-processing-times, dataset-creator-type.test.ts), and the licence is usa.gov's government works, since a
 *   work of the United States Government carries no copyright (17 U.S.C. 105) and we claim nothing over it. That's
 *   deliberate: the Terms' §6 separates the federal records from our compilation, so don't point these at the Terms;
 * - anything this site compiles (measured or community): the site's Organization is the creator, by reference, under
 *   the Terms' compilation clause (getDatasetSchema).
 *
 * The page's lead dataset, the first key, decides. A page passes `isBasedOn` only when its figures come from a
 * narrower page of the source than the key's own (the processing-times page for a queue measured from it).
 * `src/lib/__tests__/structured-data-gate.test.ts` holds that no page writes a Dataset node of its own.
 */

import { datasetKind } from "@/lib/datasetCoverage";
import { getDatasetSchema, type DatasetSchemaInput } from "@/lib/structuredData";

/** A work of the United States Government: 17 U.S.C. 105, no copyright. */
export const GOVERNMENT_WORKS = "https://www.usa.gov/government-works";

const DOL_PERFORMANCE = "https://www.dol.gov/agencies/eta/foreign-labor/performance";
const DOL_CASE_STATUS = "https://flag.dol.gov/case-status-search";
const DOL_PROCESSING_TIMES = "https://flag.dol.gov/processingtimes";
const USCIS_DATA_PAGE = "https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data";
const USCIS_CASE_STATUS = "https://egov.uscis.gov/";

const USCIS = { name: "U.S. Citizenship and Immigration Services", url: "https://www.uscis.gov" };
const OFLC = { name: "Office of Foreign Labor Certification, US Department of Labor", url: DOL_PROCESSING_TIMES };

export interface DatasetOrigin {
  /** The agency page the records come from. */
  basedOn: string;
  /** The agency, for its own table printed as published; absent for what this site compiles. */
  agency?: { name: string; url?: string };
}

/** Where each dataset a page builds a Dataset node from comes from. A key a page names must be here. */
export const DATASET_ORIGINS: Readonly<Record<string, DatasetOrigin>> = {
  // DOL's disclosure files, and what this site compiles from them.
  "perm-cases": { basedOn: DOL_PERFORMANCE },
  entities: { basedOn: DOL_PERFORMANCE },
  "pw-disclosure": { basedOn: DOL_PERFORMANCE },
  "lca-disclosure": { basedOn: DOL_PERFORMANCE },
  "daily-decisions": { basedOn: DOL_PERFORMANCE },
  // DOL's live case-status service, read by this site every day.
  "perm-case-status": { basedOn: DOL_CASE_STATUS },
  // O*NET's occupations, joined to DOL's files here.
  onet: { basedOn: "https://www.onetonline.org/" },
  // USCIS's Case Status page, checked for a spread of receipt numbers every day.
  "uscis-sample": { basedOn: USCIS_CASE_STATUS },
  // The agencies' own tables, printed as published.
  "processing-times": { basedOn: DOL_PROCESSING_TIMES, agency: OFLC },
  "uscis-form-quarters": { basedOn: USCIS_DATA_PAGE, agency: USCIS },
  "uscis-i485-offices": { basedOn: USCIS_DATA_PAGE, agency: USCIS },
  "uscis-rfe": { basedOn: USCIS_DATA_PAGE, agency: USCIS },
  "uscis-eb-awaiting-visa": { basedOn: USCIS_DATA_PAGE, agency: USCIS },
};

/** What a page says about its own slice; who made it, its source and its licence come from the datasets. */
export type DatasetPageInput = Omit<DatasetSchemaInput, "license" | "isBasedOn"> & {
  /** A narrower page of the source than the lead dataset's own, when the figures come from one. */
  isBasedOn?: string;
  /** Where an agency's table is about one place (a field office), the place's name. */
  place?: string;
};

/** The origin of a page's lead dataset; throws on a key with none, so a page can't ship a Dataset that names no source. */
export function datasetOrigin(datasets: readonly string[]): DatasetOrigin {
  const lead = datasets[0];
  const origin = lead === undefined ? undefined : DATASET_ORIGINS[lead];
  if (!origin) throw new Error(`No origin is written for the dataset "${lead ?? ""}" (src/lib/datasetSchema.ts)`);
  return origin;
}

/**
 * The Dataset node for a page whose figures come from `datasets` (the keys its `DataProvenance` takes, lead first).
 *
 * An agency's own table carries the agency as creator and the government-works licence, is free to read
 * (`isAccessibleForFree`), and names a place only when it's about one. Anything compiled here goes through
 * getDatasetSchema: the site's Organization as creator, the Terms as licence, the United States as its place.
 */
export function datasetSchemaFor(baseUrl: string, datasets: readonly [string, ...string[]], input: DatasetPageInput) {
  const origin = datasetOrigin(datasets);
  const { place, isBasedOn, ...rest } = input;
  if (!origin.agency) return getDatasetSchema(baseUrl, { ...rest, isBasedOn: isBasedOn ?? origin.basedOn });
  return {
    "@context": "https://schema.org",
    "@type": "Dataset" as const,
    name: rest.name,
    description: rest.description,
    url: rest.url,
    ...(rest.dateModified ? { dateModified: rest.dateModified } : {}),
    ...(rest.temporalCoverage ? { temporalCoverage: rest.temporalCoverage } : {}),
    isBasedOn: isBasedOn ?? origin.basedOn,
    creator: { "@type": "Organization" as const, ...origin.agency },
    isAccessibleForFree: true,
    license: GOVERNMENT_WORKS,
    ...(place ? { spatialCoverage: { "@type": "Place" as const, name: place } } : {}),
    ...(rest.variableMeasured ? { variableMeasured: rest.variableMeasured } : {}),
    ...(rest.keywords ? { keywords: rest.keywords } : {}),
    ...(rest.distribution
      ? { distribution: rest.distribution.map((d) => ({ "@type": "DataDownload" as const, ...d })) }
      : {}),
  };
}

/** Whether each written origin agrees with its source kind: an agency's table is official, a compilation isn't. */
export function originsMatchKinds(): string[] {
  return Object.entries(DATASET_ORIGINS).flatMap(([key, o]) => {
    const kind = datasetKind(key);
    if (kind === null) return [`${key} has no row in DATASET_COVERAGE`];
    if (o.agency && kind !== "official") return [`${key} names an agency as creator but its kind is ${kind}`];
    return [];
  });
}
