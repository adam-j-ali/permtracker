/**
 * The API's description: ONE REGISTRY, read by everything that describes or
 * serves the API.
 *
 *   /v1/openapi.json   the OpenAPI 3.1 document, built from it
 *   /mcp               one assistant tool per read operation, same name and inputs
 *   /developers        the endpoint list, the error list and the examples
 *   /v1                the index
 *   the SDKs' tests    one method per operation
 *
 * A test holds every path here to a route file under src/app/v1 and every
 * route file to a path here, every example to its schema, and every tool to
 * its operation. Add an endpoint by adding it here first.
 *
 * Pure: no server-only import. Answers' shapes live in ./schemas.ts and the
 * error codes in ./errors.ts.
 */
import { z } from "zod";

import { API_PLANS } from "@convex/lib/apiPlans";
import { WEBHOOK_EVENTS } from "@convex/lib/webhookSign";

import { API_BASE, DEVELOPERS_URL, MCP_URL } from "./addresses";
import { API_ERRORS, errorAnchor, errorsWithStatus } from "./errors";
import { sandboxAnswer } from "./sandbox";
import {
  CaseSchema,
  CaseSearchSchema,
  DoneSchema,
  EmployerLookupSchema,
  EntitySchema,
  EntitySearchSchema,
  EstimateSchema,
  ExportSchema,
  HealthSchema,
  MeSchema,
  MetaSchema,
  PROGRAMS,
  ProblemSchema,
  QueueSchema,
  SocLookupSchema,
  VisaBulletinSchema,
  WebhookCreatedSchema,
  WebhookListSchema,
} from "./schemas";

/** The description's own version. Additions raise the middle number; nothing is removed inside version 1. */
export const API_VERSION = "1.1.0";

export { API_BASE, DEVELOPERS_URL, MCP_URL };

/** The groups the endpoints are listed under, in the order the docs show them. */
export const TAGS = [
  { name: "Cases", description: "One DOL case by its number, or cases found from what you know about them. PERM, prevailing wage, H-1B LCA, H-2A, H-2B and CW-1." },
  { name: "Timing", description: "DOL's processing times, the pending PERM queue by filing month, and an estimate of when a pending PERM case is likely to be decided." },
  { name: "Visa bulletin", description: "The State Department's monthly visa bulletin charts, as printed, back to June 2005." },
  { name: "Employers, law firms and occupations", description: "Each one's PERM record from DOL's published files, and its cases pending at DOL now. Search by name, then get one by its slug." },
  { name: "Lookups", description: "Two lookups that need no key, under shared limits: a printed employer name to its page, and a job title to its SOC codes." },
  { name: "Exports", description: "A search's whole answer, past one page, as CSV or JSON. Needs the export scope." },
  { name: "Webhooks", description: "Signed deliveries when a watched case changes status, DOL moves an employer's cases, a visa bulletin is published or the queue moves. Needs the webhooks scope." },
  { name: "Account", description: "Your key's plan and usage, and whether the API is up." },
] as const;

export type TagName = (typeof TAGS)[number]["name"];

export interface ParamDoc {
  name: string;
  in: "path" | "query";
  required: boolean;
  description: string;
  /** A value that works, shown in the docs and sent as the OpenAPI example. */
  example: string | number;
  /** string unless said. */
  type?: "string" | "integer";
  /** The only values it takes. */
  enum?: readonly string[];
  /** date: YYYY-MM-DD. month: YYYY-MM. */
  format?: "date" | "month";
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: string | number;
  /** Not offered on the assistant tool (it needs a scope a tool call can't hold). */
  apiOnly?: boolean;
}

export interface EndpointDoc {
  /** The operationId: camelCase, unique, and never renamed. The assistant tool and the SDK methods take their names from it. */
  id: string;
  tag: TagName;
  path: string;
  /** GET unless said; one path can carry several methods, each its own entry. */
  method?: "GET" | "POST" | "DELETE";
  /** What it does, in a few words. */
  summary: string;
  /** Everything a caller needs to know to use it. */
  description: string;
  /** One example call, path and query only. */
  example: string;
  params?: ParamDoc[];
  /** Whether the call counts against the plan's allowance. */
  counted: boolean;
  /** Answered without a key, under shared limits (the browser extension's lookup). */
  keyless?: boolean;
  /** The scope a key needs beyond reading public records. */
  scope?: "export" | "live_lookup" | "webhooks";
  /** Its route gives a sandbox key its own answer rather than the shared samples. */
  sandboxOwn?: boolean;
  /** A POST's JSON body. */
  body?: { description: string; schema: z.ZodType; example: Record<string, unknown> };
  /** The answer's `data`: its schema, and an example that the tests hold to the schema. */
  response: { schema: z.ZodType; schemaName: string; example: unknown; meta?: { source: string; asOf: string | null; url: string } };
  /** Offered at /mcp as an assistant tool, under this title. Reads of public records only. */
  tool?: { title: string };
}

/** `getCase` to `get_case`: an operation's assistant tool name. */
export function toolName(id: string): string {
  return id.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** A sandbox key's answer for a path, as the docs' example of that endpoint's answer. */
function sample(pathAndQuery: string, params: Record<string, string> = {}): { example: unknown; meta: { source: string; asOf: string | null; url: string } } {
  const r = sandboxAnswer(new URL(`https://permtracker.app/v1${pathAndQuery}`), params);
  if (!r.ok) throw new Error(`openapi: the sandbox has no sample for ${pathAndQuery}`);
  return { example: r.data, meta: r.meta };
}

const NAME_Q: ParamDoc = { name: "q", in: "query", required: true, description: "2 to 120 characters of the name.", example: "acme", minLength: 2, maxLength: 120 };
const LIMIT: ParamDoc = { name: "limit", in: "query", required: false, description: "Results to return, 1 to 100.", example: 25, type: "integer", minimum: 1, maximum: 100, default: 25 };
const SLUG = (example: string): ParamDoc => ({ name: "slug", in: "path", required: true, description: "The name in its page's address, as search returns it.", example, maxLength: 120 });

const SAMPLE_ENTITY_SEARCH = (segment: string, q: string) => sample(`/${segment}?q=${q}`);
const SAMPLE_ENTITY = (segment: string, slug: string) => sample(`/${segment}/${slug}`, { slug });

export const ENDPOINTS: EndpointDoc[] = [
  {
    id: "getCase",
    tag: "Cases",
    path: "/cases/{caseNumber}",
    summary: "Get one case by its number",
    description:
      "One case by number: its status, filing date, employer and, once decided, DOL's record. Covers PERM, prevailing wage, H-1B LCA and H-2A, H-2B and CW-1 (applications, job orders and wage requests). A seasonal case adds its workers, work period and worksite, and the job as DOL accepted it. A pending PERM case adds its filing month's place in the queue.",
    example: "/cases/G-100-26045-123456",
    params: [
      {
        name: "caseNumber",
        in: "path",
        required: true,
        description: "As DOL prints it: G-100-... for PERM, P-100-... for a prevailing wage request, I-200-... for an H-1B LCA, H-300-..., H-400-..., JO-A-300-... or C-500-... for the seasonal programs.",
        example: "G-100-26045-123456",
        maxLength: 40,
      },
      {
        name: "live",
        in: "query",
        required: false,
        description:
          "1 to ask DOL now when our records don't hold the number yet. Needs the live_lookup scope. Plus has 200 a day, and every account together 20,000.",
        example: "1",
        enum: ["1"],
        apiOnly: true,
      },
    ],
    counted: true,
    response: { schema: CaseSchema, schemaName: "Case", ...sample("/cases/G-100-26000-000101", { caseNumber: "G-100-26000-000101" }) },
    tool: { title: "Get a case by its number" },
  },
  {
    id: "findCases",
    tag: "Cases",
    path: "/cases",
    summary: "Find cases without a case number",
    description:
      "Find a case from what you know about it: any of the employer's name, words of the job title and the law firm, with one filing day, a range of days or no date. One of them is enough. Each case comes with its number, status, job and filing day, and the answer says what DOL's record holds for the days read. With no employer fitting in a month or less, it returns the employers that did file in those days under a close spelling.",
    example: "/cases?employer=Acme&from=2026-01-05&to=2026-01-31",
    params: [
      { name: "employer", in: "query", required: false, description: "The employer's name, 2 to 120 characters. Inc, LLC and punctuation don't matter. With dates three months apart or less, any word of the name fits; with no dates or a longer range, the start of the name.", example: "Acme", minLength: 2, maxLength: 120 },
      { name: "job", in: "query", required: false, description: "Words of the job title, up to 80 characters. Alone, with no dates, it reads the newest three months.", example: "controls engineer", maxLength: 80 },
      { name: "firm", in: "query", required: false, description: "The law firm's or agent's name, 2 to 120 characters. DOL names a firm only once it decides a case, so the answer holds decided cases only.", example: "Fragomen", minLength: 2, maxLength: 120 },
      { name: "filed", in: "query", required: false, description: "One filing day, from 2019-10-01 to today. Not with from or to.", example: "2026-01-30", format: "date" },
      { name: "from", in: "query", required: false, description: "The first filing day of a range. Alone, it is that one day.", example: "2026-01-05", format: "date" },
      { name: "to", in: "query", required: false, description: "The last filing day of a range. A range longer than three months needs an employer or a firm.", example: "2026-01-31", format: "date" },
      { name: "program", in: "query", required: false, description: "Which program to search.", example: "perm", enum: PROGRAMS, default: "perm" },
    ],
    counted: true,
    response: { schema: CaseSearchSchema, schemaName: "CaseSearch", ...sample("/cases?employer=Example&filed=2026-02-10") },
    tool: { title: "Find cases without a case number" },
  },
  {
    id: "estimateDecision",
    tag: "Timing",
    path: "/estimate",
    summary: "Estimate a PERM decision date",
    description:
      "When a pending PERM case is likely to be decided, with the range, the model and its caveats. Send a case number, or a filing date for a case in analyst review. It's an estimate from DOL's measured pace and makes no promise: show the caveats with the date.",
    example: "/estimate?filed=2026-02-15",
    params: [
      { name: "case", in: "query", required: false, description: "A PERM case number. Its own status and filing date are used.", example: "G-100-26045-123456", maxLength: 40 },
      { name: "filed", in: "query", required: false, description: "A filing date, for a case in analyst review, when there's no case number.", example: "2026-02-15", format: "date" },
    ],
    counted: true,
    response: { schema: EstimateSchema, schemaName: "Estimate", ...sample("/estimate?filed=2026-02-10") },
    tool: { title: "Estimate a PERM decision date" },
  },
  {
    id: "getQueue",
    tag: "Timing",
    path: "/queue",
    summary: "Get DOL's processing times and the pending queue",
    description:
      "DOL's processing times (average days, and the month each queue is working on when DOL prints one), the filing month DOL is deciding by PERM Tracker's daily check of case statuses (perm.decidingNow: DOL stopped printing a PERM month on Oct 31 2026), the oldest month still open, and the pending PERM cases by filing month.",
    example: "/queue",
    counted: true,
    response: { schema: QueueSchema, schemaName: "Queue", ...sample("/queue") },
    tool: { title: "Get processing times and the pending queue" },
  },
  {
    id: "getVisaBulletin",
    tag: "Visa bulletin",
    path: "/visa-bulletin",
    summary: "Get a visa bulletin's charts",
    description:
      "A visa bulletin's employment and family charts (final action dates and dates for filing), as the State Department printed them. The newest by default.",
    example: "/visa-bulletin?month=2026-10",
    params: [{ name: "month", in: "query", required: false, description: "The bulletin's month, back to 2005-06. Leave out for the newest.", example: "2026-10", format: "month" }],
    counted: true,
    response: { schema: VisaBulletinSchema, schemaName: "VisaBulletin", ...sample("/visa-bulletin") },
    tool: { title: "Get a visa bulletin" },
  },
  {
    id: "searchEmployers",
    tag: "Employers, law firms and occupations",
    path: "/employers",
    summary: "Search employers by name",
    description: "Employers whose name matches, best first. Each result carries its PERM record and the slug that the get endpoint takes.",
    example: "/employers?q=acme",
    params: [NAME_Q, LIMIT],
    counted: true,
    response: { schema: EntitySearchSchema, schemaName: "EntitySearch", ...SAMPLE_ENTITY_SEARCH("employers", "example") },
    tool: { title: "Search employers by name" },
  },
  {
    id: "getEmployer",
    tag: "Employers, law firms and occupations",
    path: "/employers/{slug}",
    summary: "Get one employer's PERM record",
    description:
      "One employer's PERM record: cases, certified and denied, median days to decision, filings in the last 12 months, and how many of its cases are pending at DOL now, by stage. Find the slug with the search first.",
    example: "/employers/google-llc",
    params: [SLUG("google-llc")],
    counted: true,
    response: { schema: EntitySchema, schemaName: "Entity", ...SAMPLE_ENTITY("employers", "example-robotics-llc") },
    tool: { title: "Get an employer's PERM record" },
  },
  {
    id: "searchLawFirms",
    tag: "Employers, law firms and occupations",
    path: "/law-firms",
    summary: "Search law firms by name",
    description: "Law firms and agents whose name matches, best first. Each result carries its PERM record and the slug that the get endpoint takes.",
    example: "/law-firms?q=fragomen",
    params: [{ ...NAME_Q, example: "fragomen" }, LIMIT],
    counted: true,
    response: { schema: EntitySearchSchema, schemaName: "EntitySearch", ...SAMPLE_ENTITY_SEARCH("law-firms", "sample") },
    tool: { title: "Search law firms by name" },
  },
  {
    id: "getLawFirm",
    tag: "Employers, law firms and occupations",
    path: "/law-firms/{slug}",
    summary: "Get one law firm's PERM record",
    description: "One law firm's PERM record from DOL's published files, and how many of its cases are pending at DOL now, by stage. Find the slug with the search first.",
    example: "/law-firms/fragomen-del-rey-bernsen-loewy-llp",
    params: [SLUG("fragomen-del-rey-bernsen-loewy-llp")],
    counted: true,
    response: { schema: EntitySchema, schemaName: "Entity", ...SAMPLE_ENTITY("law-firms", "sample-partners-llp") },
    tool: { title: "Get a law firm's PERM record" },
  },
  {
    id: "searchOccupations",
    tag: "Employers, law firms and occupations",
    path: "/occupations",
    summary: "Search occupations by title",
    description: "Occupations whose title matches, best first. Each result carries its SOC code, its PERM record and the slug that the get endpoint takes.",
    example: "/occupations?q=software",
    params: [{ ...NAME_Q, description: "2 to 120 characters of the title.", example: "software" }, LIMIT],
    counted: true,
    response: { schema: EntitySearchSchema, schemaName: "EntitySearch", ...SAMPLE_ENTITY_SEARCH("occupations", "software") },
    tool: { title: "Search occupations by title" },
  },
  {
    id: "getOccupation",
    tag: "Employers, law firms and occupations",
    path: "/occupations/{slug}",
    summary: "Get one occupation's PERM record",
    description: "One occupation's PERM record, with its SOC code and median offered wage, and its cases pending at DOL now. Find the slug with the search first.",
    example: "/occupations/software-developers",
    params: [SLUG("software-developers")],
    counted: true,
    response: { schema: EntitySchema, schemaName: "Entity", ...SAMPLE_ENTITY("occupations", "software-developers") },
    tool: { title: "Get an occupation's PERM record" },
  },
  {
    id: "lookupEmployer",
    tag: "Lookups",
    path: "/lookup/employer",
    summary: "Match a printed employer name to its page",
    description:
      "The employer page a printed name belongs to: an exact match, a possible one with the matched name, or none. It comes with the employer's PERM decisions, certified share, pending cases, newest filing and H-1B LCAs. No key: it's what the browser extension calls, under shared limits of 60 calls a minute per address.",
    example: "/lookup/employer?name=Google",
    params: [{ name: "name", in: "query", required: true, description: "The employer's name as a job posting prints it, 2 to 120 characters.", example: "Google", minLength: 2, maxLength: 120 }],
    counted: false,
    keyless: true,
    response: {
      schema: EmployerLookupSchema,
      schemaName: "EmployerLookup",
      example: {
        query: "Example Robotics",
        shareFloor: 10,
        match: "exact",
        employer: {
          name: "Example Robotics LLC",
          slug: "example-robotics-llc",
          url: "https://permtracker.app/perm-employers/example-robotics-llc",
          page: "perm",
          perm: { published: 86, certified: 81, denied: 2, certifiedShare: 0.976, pending: 14, newestFiling: "2026-09-18", filingsLast12Months: 22 },
          h1bLcas: 240,
          wageRequests: 31,
        },
      },
      meta: { source: "U.S. Department of Labor, OFLC disclosure files and FLAG case status", asOf: "2026-10-01", url: "https://permtracker.app/perm-employers/example-robotics-llc" },
    },
    tool: { title: "Match an employer's name to its page" },
  },
  {
    id: "lookupSoc",
    tag: "Lookups",
    path: "/lookup/soc",
    summary: "Find the SOC codes for a job title",
    description:
      "The SOC codes employers filed a job title under in DOL's PERM, prevailing wage and LCA files, with each code's share of the title's filings. For a code: its title, O*NET's description and core tasks, the titles employers filed most under it, and its PERM approval rate and median offered wage (under the site's floors). For a 2010 code: the 2018 codes it became. No key, under the same shared limits as the employer lookup.",
    example: "/lookup/soc?q=data%20scientist",
    params: [{ name: "q", in: "query", required: true, description: "A job title or a SOC code (15-1252, 15-1252.00 or 151252), 2 to 80 characters.", example: "data scientist", minLength: 2, maxLength: 80 }],
    counted: false,
    keyless: true,
    response: {
      schema: SocLookupSchema,
      schemaName: "SocLookup",
      example: {
        query: "data scientist",
        code: null,
        titles: [
          {
            title: "Data Scientist",
            filings: 4120,
            codes: [
              { soc: "15-2051", title: "Data Scientists", filings: 3290, share: 0.8, onetLists: true, became: [] },
              { soc: "15-1252", title: "Software Developers", filings: 510, share: 0.12, onetLists: false, became: [] },
            ],
          },
        ],
        codes: [{ soc: "15-2051", title: "Data Scientists" }],
      },
      meta: {
        source: "U.S. Department of Labor, OFLC disclosure files (PERM, prevailing wage, LCA), and the O*NET 31.0 Database (USDOL/ETA, CC BY 4.0)",
        asOf: null,
        url: "https://permtracker.app/soc-codes?q=data%20scientist",
      },
    },
    tool: { title: "Find a job title's SOC codes" },
  },
  {
    id: "exportRecords",
    tag: "Exports",
    path: "/exports/{kind}",
    summary: "Export a search's whole answer",
    description:
      "A search's whole answer, past one page, as CSV (format=csv) or JSON: cases (the case search's parameters, such as q, firm, state, occupation, outcome, and from and to for the filing date as a month, YYYY-MM, or one day, YYYY-MM-DD), employers, law-firms or occupations (q). Needs the export scope. Plus exports up to 1,000 rows a call and 20,000 rows a day. Counted as one call.",
    example: "/exports/employers?q=acme&format=csv",
    params: [
      { name: "kind", in: "path", required: true, description: "What to export.", example: "employers", enum: ["cases", "employers", "law-firms", "occupations"] },
      { name: "q", in: "query", required: false, description: "The name to search (an employer for cases).", example: "acme", maxLength: 120 },
      { name: "format", in: "query", required: false, description: "The answer's form.", example: "csv", enum: ["json", "csv"], default: "json" },
      { name: "limit", in: "query", required: false, description: "Rows to return, up to the plan's export cap.", example: 500, type: "integer", minimum: 1 },
    ],
    counted: true,
    scope: "export",
    sandboxOwn: true,
    response: {
      schema: ExportSchema,
      schemaName: "Export",
      example: {
        kind: "employers",
        rows: [{ kind: "employer", slug: "example-robotics-llc", name: "Example Robotics LLC", publishedCases: 86, certified: 81, denied: 2 }],
        count: 1,
        cap: 1000,
        truncated: false,
        note: null,
      },
    },
  },
  {
    id: "listWebhooks",
    tag: "Webhooks",
    path: "/webhooks",
    summary: "List webhook endpoints",
    description:
      "This account's webhook endpoints (url, events, whether paused, the secret's last four characters) and its watches, with every event an endpoint can ask for. Needs the webhooks scope.",
    example: "/webhooks",
    counted: true,
    scope: "webhooks",
    sandboxOwn: true,
    response: {
      schema: WebhookListSchema,
      schemaName: "WebhookList",
      example: {
        endpoints: [{ id: "jd7abc123def456ghi789", url: "https://example.com/hooks/perm", events: ["case.status_changed"], paused: false, secretLast4: "9f2c" }],
        watches: [{ kind: "case", caseNumber: "G-100-26045-123456" }],
        events: [...WEBHOOK_EVENTS],
      },
    },
  },
  {
    id: "createWebhook",
    tag: "Webhooks",
    path: "/webhooks",
    method: "POST",
    summary: "Add a webhook endpoint",
    description:
      "Add an endpoint: a public https address and the events it wants. The answer carries the signing secret, the only time it's shown; keep it to check each delivery's webhook-signature header. Plus has 5 endpoints. Needs the webhooks scope.",
    example: "/webhooks",
    counted: true,
    scope: "webhooks",
    sandboxOwn: true,
    body: {
      description: `url (public https) and events, any of: ${WEBHOOK_EVENTS.join(", ")}.`,
      schema: z.object({
        url: z.string().describe("A public https address that answers within 10 seconds."),
        events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).describe("The events the endpoint wants."),
      }),
      example: { url: "https://example.com/hooks/perm", events: ["case.status_changed", "bulletin.published"] },
    },
    response: {
      schema: WebhookCreatedSchema,
      schemaName: "WebhookCreated",
      example: { id: "jd7abc123def456ghi789", url: "https://example.com/hooks/perm", events: ["case.status_changed", "bulletin.published"], secret: "whsec_shown_once", note: "This is the only time the secret is shown. Use it to check each delivery's webhook-signature header." },
    },
  },
  {
    id: "deleteWebhook",
    tag: "Webhooks",
    path: "/webhooks/{id}",
    method: "DELETE",
    summary: "Delete a webhook endpoint",
    description: "Delete an endpoint and its delivery log. Needs the webhooks scope.",
    example: "/webhooks/jd7abc123def456ghi789",
    params: [{ name: "id", in: "path", required: true, description: "The endpoint's id, from the list of webhooks.", example: "jd7abc123def456ghi789", maxLength: 64 }],
    counted: true,
    scope: "webhooks",
    sandboxOwn: true,
    response: { schema: DoneSchema, schemaName: "Done", example: { deleted: true } },
  },
  {
    id: "listWatches",
    tag: "Webhooks",
    path: "/watches",
    summary: "List watched cases and employers",
    description: "The case numbers and employers this account's webhooks watch, with its endpoints. Needs the webhooks scope.",
    example: "/watches",
    counted: true,
    scope: "webhooks",
    sandboxOwn: true,
    response: {
      schema: WebhookListSchema,
      schemaName: "WebhookList",
      example: {
        endpoints: [{ id: "jd7abc123def456ghi789", url: "https://example.com/hooks/perm", events: ["case.status_changed"], paused: false, secretLast4: "9f2c" }],
        watches: [{ kind: "case", caseNumber: "G-100-26045-123456" }],
        events: [...WEBHOOK_EVENTS],
      },
    },
  },
  {
    id: "createWatch",
    tag: "Webhooks",
    path: "/watches",
    method: "POST",
    summary: "Watch a case or an employer",
    description:
      "Watch a case number (case.status_changed fires when DOL's status for it changes) or an employer's page (employer.moved fires when DOL moves its cases as a group). Plus watches 100. Needs the webhooks scope.",
    example: "/watches",
    counted: true,
    scope: "webhooks",
    sandboxOwn: true,
    body: {
      description: "One of caseNumber (as DOL prints it) or employer (its page's slug, from the employer search).",
      schema: z.object({
        caseNumber: z.string().optional().describe("A case number as DOL prints it."),
        employer: z.string().optional().describe("An employer's slug, from the employer search."),
      }),
      example: { caseNumber: "G-100-26045-123456" },
    },
    response: { schema: DoneSchema, schemaName: "Done", example: { watching: "G-100-26045-123456", kind: "case" } },
  },
  {
    id: "deleteWatch",
    tag: "Webhooks",
    path: "/watches/{target}",
    method: "DELETE",
    summary: "Stop watching a case or an employer",
    description: "Stop watching a case number, or an employer with kind=employer. Needs the webhooks scope.",
    example: "/watches/G-100-26045-123456",
    params: [
      { name: "target", in: "path", required: true, description: "The case number, or the employer's slug.", example: "G-100-26045-123456", maxLength: 120 },
      { name: "kind", in: "query", required: false, description: "What the target is.", example: "case", enum: ["case", "employer"], default: "case" },
    ],
    counted: true,
    scope: "webhooks",
    sandboxOwn: true,
    response: { schema: DoneSchema, schemaName: "Done", example: { removed: true } },
  },
  {
    id: "getMe",
    tag: "Account",
    path: "/me",
    summary: "Get your key's plan and usage",
    description: "Your key, the plan whose limits apply to it, and what you've used today and this month. Not counted, so it answers even when a day's allowance is spent.",
    example: "/me",
    counted: false,
    sandboxOwn: true,
    response: {
      schema: MeSchema,
      schemaName: "Me",
      example: {
        key: { id: "k_example", sandbox: false, scopes: ["read"], expiresAt: null },
        plan: { id: "plus", name: "Plus", perMinute: 60, perDay: 5000, perMonth: 100000, keys: 5, sandboxKeys: 2, exportRows: 1000, exportRowsPerDay: 20000, liveLookupsPerDay: 200, webhookEndpoints: 5, webhookWatches: 100 },
        accountPlan: { id: "free", name: "Free" },
        paywall: { enforced: false, note: "Paid features are free for now: every account gets the Plus plan's limits until billing opens." },
        usage: { today: 12, thisMonth: 340, remainingToday: 4988, remainingThisMonth: 99660, liveLookupsToday: 0, liveLookupsRemainingToday: 200, exportRowsToday: 0, exportRowsRemainingToday: 20000, dayResetsInSeconds: 40210, monthResetsInSeconds: 1450000 },
      },
    },
  },
  {
    id: "getHealth",
    tag: "Account",
    path: "/health",
    summary: "Check the API is up",
    description: "Answers ok when the API is serving, with the description's version and where the docs are. No key, never counted, and it reads no records, so it says the API is up and nothing about any one dataset's freshness (each answer's meta.asOf says that).",
    example: "/health",
    counted: false,
    keyless: true,
    sandboxOwn: true,
    response: {
      schema: HealthSchema,
      schemaName: "Health",
      example: { status: "ok", version: API_VERSION, docs: DEVELOPERS_URL, openapi: `${API_BASE}/openapi.json` },
    },
  },
];

/** The operations offered at /mcp as assistant tools: every read of public records. */
export const TOOL_ENDPOINTS: readonly EndpointDoc[] = ENDPOINTS.filter((e) => e.tool);

/* ------------------------------------------------------------------ */
/* The OpenAPI document                                                */
/* ------------------------------------------------------------------ */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  void _drop;
  return rest;
};

function paramSchema(p: ParamDoc): Record<string, unknown> {
  return {
    type: p.type ?? "string",
    ...(p.enum ? { enum: [...p.enum] } : {}),
    ...(p.format === "date" ? { format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } : {}),
    ...(p.format === "month" ? { pattern: "^\\d{4}-\\d{2}$" } : {}),
    ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
    ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
    ...(p.minimum !== undefined ? { minimum: p.minimum } : {}),
    ...(p.maximum !== undefined ? { maximum: p.maximum } : {}),
    ...(p.default !== undefined ? { default: p.default } : {}),
  };
}

const STATUS_RESPONSE: Record<number, { name: string; description: string }> = {
  400: { name: "BadRequest", description: "The request isn't valid. Not counted." },
  401: { name: "Unauthorized", description: "No key, or a key that's unknown, revoked or expired." },
  403: { name: "Forbidden", description: "The key lacks the scope, or the plan lacks the feature. Not counted." },
  404: { name: "NotFound", description: "No such record. Counted, like an answer." },
  429: { name: "TooManyRequests", description: "A minute, day or month limit. Retry-After says when it lifts. Not counted." },
  500: { name: "ServerError", description: "Something went wrong on our side. Nothing was counted." },
  503: { name: "Unavailable", description: "A part the call needs can't be reached right now. Retry-After says when to try again. Not counted." },
};

const RATE_HEADERS = {
  "RateLimit-Limit": { description: "The plan's calls a minute.", schema: { type: "integer" } },
  "RateLimit-Remaining": { description: "Calls left in this minute.", schema: { type: "integer" } },
  "RateLimit-Reset": { description: "Seconds until the minute turns.", schema: { type: "integer" } },
};

function problemExample(status: number): Record<string, unknown> {
  const e = errorsWithStatus(status)[0]!;
  return {
    type: `${DEVELOPERS_URL}#${errorAnchor(e.code)}`,
    title: e.title,
    status,
    detail: e.meaning,
    code: e.code,
    ...(status === 429 ? { retryAfter: 42 } : {}),
    error: { code: e.code, message: e.meaning, ...(status === 429 ? { retryAfter: 42 } : {}), docs: DEVELOPERS_URL },
  };
}

function errorStatuses(e: EndpointDoc): number[] {
  // It reads nothing and checks no key, so the only refusal is the front door's, for an address asking too fast.
  if (e.id === "getHealth") return [429];
  return [
    400,
    ...(e.keyless ? [] : [401]),
    ...(e.scope || e.method || e.params?.some((p) => p.apiOnly) ? [403] : []),
    404,
    429,
    500,
    503,
  ];
}

export function openApiDocument(): Record<string, unknown> {
  const free = API_PLANS.free;
  const schemas: Record<string, unknown> = { Meta: jsonSchema(MetaSchema), Problem: jsonSchema(ProblemSchema) };
  const paths: Record<string, unknown> = {};

  for (const e of ENDPOINTS) {
    schemas[e.response.schemaName] ??= jsonSchema(e.response.schema);
    const method = (e.method ?? "GET").toLowerCase();
    const isHealth = e.id === "getHealth";
    const notes = [
      e.keyless ? "No key needed." : e.scope ? `Needs a key with the ${e.scope} scope.` : "Needs a key.",
      e.counted ? "Counted as one call." : "Not counted against the plan's allowance.",
      e.tool ? `Also offered to AI assistants as the ${toolName(e.id)} tool at ${MCP_URL}.` : "",
    ].filter(Boolean);
    const op = {
      operationId: e.id,
      tags: [e.tag],
      summary: e.summary,
      description: `${e.description}\n\n${notes.join(" ")}`,
      ...(e.keyless ? { security: [] } : {}),
      parameters: (e.params ?? []).map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required,
        description: p.description,
        schema: paramSchema(p),
        example: p.example,
      })),
      ...(e.body
        ? {
            requestBody: {
              required: true,
              description: e.body.description,
              content: { "application/json": { schema: jsonSchema(e.body.schema), example: e.body.example } },
            },
          }
        : {}),
      responses: {
        "200": {
          description: isHealth
            ? "The API is up."
            : "The answer in `data`, and in `meta` the source, the date the data is true for and the page that shows it.",
          ...(isHealth || e.keyless ? {} : { headers: RATE_HEADERS }),
          content: {
            "application/json": {
              schema: isHealth
                ? ref(e.response.schemaName)
                : { type: "object", required: ["data", "meta"], properties: { data: ref(e.response.schemaName), meta: ref("Meta") } },
              example: isHealth ? e.response.example : { data: e.response.example, meta: e.response.meta ?? SAMPLE_META },
            },
          },
        },
        ...Object.fromEntries(errorStatuses(e).map((status) => [String(status), { $ref: `#/components/responses/${STATUS_RESPONSE[status]!.name}` }])),
      },
    };
    paths[e.path] = { ...((paths[e.path] as Record<string, unknown> | undefined) ?? {}), [method]: op };
  }

  const responses = Object.fromEntries(
    Object.entries(STATUS_RESPONSE).map(([status, r]) => {
      const codes = errorsWithStatus(Number(status)).map((x) => x.code);
      return [
        r.name,
        {
          description: `${r.description} Codes: ${codes.join(", ")}.`,
          ...(status === "429" || status === "503"
            ? { headers: { "Retry-After": { description: "Seconds until it's worth trying again.", schema: { type: "integer" } } } }
            : {}),
          content: { "application/problem+json": { schema: ref("Problem"), example: problemExample(Number(status)) } },
        },
      ];
    }),
  );

  return {
    openapi: "3.1.0",
    info: {
      title: "PERM Tracker API",
      summary: "Federal PERM, prevailing wage, H-1B and visa bulletin records, as JSON.",
      version: API_VERSION,
      description:
        `U.S. employment-based immigration records from the Department of Labor and the State Department, as JSON: a case by its number, cases found without one, DOL's processing times and the pending queue, an estimate of a PERM decision date, the visa bulletin, and each employer's, law firm's and occupation's PERM record.\n\n` +
        `Every answer names its source, the date it's true for and the page that shows it. The same reads are offered to AI assistants as tools at ${MCP_URL}.\n\n` +
        `Free plan: ${free.perMinute} calls a minute, ${free.perDay} a day, ${free.perMonth.toLocaleString("en-US")} a month. A sandbox key (pt_test_) answers fixed sample data and is never counted.\n\n` +
        `Errors are RFC 9457 problem documents that also carry the \`error\` object version 1 has always sent. The codes: ${API_ERRORS.map((x) => x.code).join(", ")}.`,
      termsOfService: "https://permtracker.app/api-terms",
      contact: { name: "PERM Tracker", email: "support@permtracker.app", url: DEVELOPERS_URL },
      license: { name: "API terms; the data is CC BY 4.0", url: "https://permtracker.app/api-terms" },
    },
    externalDocs: { description: "The developer page: quick start, limits, errors, webhooks, SDKs and the MCP server.", url: DEVELOPERS_URL },
    servers: [{ url: API_BASE, description: "Production" }],
    tags: TAGS.map((t) => ({ name: t.name, description: t.description })),
    security: [{ bearer: [] }, { apiKeyHeader: [] }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "Your key, pt_live_... (or pt_test_... for the sandbox), from Settings > API keys, as Authorization: Bearer <key>." },
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key", description: "The same key in an X-API-Key header, for clients that can't set Authorization." },
      },
      schemas,
      responses,
    },
    paths,
  };
}

const SAMPLE_META = { source: "PERM Tracker", asOf: null, url: DEVELOPERS_URL };

/** The assistant tools at /mcp, for the docs. A test holds this list to the tools the server registers. */
export const MCP_TOOLS: { name: string; title: string; summary: string }[] = TOOL_ENDPOINTS.map((e) => ({
  name: toolName(e.id),
  title: e.tool!.title,
  summary: e.description.split(". ")[0]!.replace(/\.$/, "") + ".",
}));

/**
 * The tool names version 1.0 used, and what each is now. A call under an old
 * name is still answered (src/app/mcp/route.ts rewrites it), so an assistant
 * or a script that learned the old names keeps working.
 */
export const LEGACY_TOOLS: Record<string, string> = {
  lookup_case: "get_case",
  find_case: "find_cases",
  queue_status: "get_queue",
  visa_bulletin: "get_visa_bulletin",
  search_sponsors: "search_employers, search_law_firms or search_occupations",
  employer_profile: "get_employer, get_law_firm or get_occupation",
  find_soc_code: "lookup_soc",
};
