/**
 * What each dataset CONTAINS, as distinct from how often it arrives.
 *
 * A source line states a cadence, and cadence is not coverage:
 *
 *   - "Quarterly" doesn't say that DOL's disclosure files hold ONLY DECIDED
 *     cases, so nothing computed from them describes a case still waiting.
 *   - "Daily" doesn't say that the live sweep INCLUDES PENDING cases but
 *     carries no wage, law firm or worksite, which DOL reveals only when it
 *     publishes a case.
 *
 * Reading one for the other gives a duration averaged over the fastest few
 * percent of a recent month, or "nothing found" for a case that simply isn't
 * decided yet. DataProvenance shows these sentences under every data page.
 *
 * One sentence per dataset, in the reader's terms, and the kind of source it is
 * (official, measured or community; src/lib/sourceKind.ts). `dataset-coverage.test.ts`
 * fails on a dataset without either.
 */
import sheetConfig from "../../scripts/data/community_sheets.json";
import type { SourceKind } from "./sourceKind";
import { officeByCode } from "./uscisOffices";

/** A dataset's row: the kind of source it is, and what it holds in one sentence. */
export interface DatasetCoverage {
  kind: SourceKind;
  text: string;
}

const official = (text: string): DatasetCoverage => ({ kind: "official", text });
const measured = (text: string): DatasetCoverage => ({ kind: "measured", text });
const community = (text: string): DatasetCoverage => ({ kind: "community", text });

/**
 * Each community sheet's sentence and name, from its own entry in scripts/data/community_sheets.json, so a sheet added
 * there is described here without a second list. A sheet with a sentence of its own below keeps that one.
 */
const SHEET_COVERAGE: Record<string, DatasetCoverage> = Object.fromEntries(
  sheetConfig.sheets.map((s) => {
    const office = "office" in s && typeof s.office === "string" ? officeByCode(s.office) : undefined;
    const where = office ? ` at USCIS's ${office.name} field office` : "";
    return [
      `community-sheet-${s.key}`,
      community(
        `The ${s.name} sheet, a public Google Sheet people keep their own green card cases in${where}, read every hour. ` +
          "Self-reported and unchecked; usernames, names, receipt numbers and comments stay in the sheet.",
      ),
    ];
  }),
);
const SHEET_LABELS: Record<string, string> = Object.fromEntries(
  sheetConfig.sheets.map((s) => [`community-sheet-${s.key}`, `The ${s.name} sheet`]),
);

export const DATASET_COVERAGE: Readonly<Record<string, DatasetCoverage>> = {
  ...SHEET_COVERAGE,
  // --- DOL quarterly disclosure files: decided only -----------------------
  "perm-cases":
    measured("Decided PERM cases only. A case still waiting isn't in here, so counts and durations describe finished cases."),
  "pw-disclosure":
    measured("Decided prevailing wage requests only, with the wage DOL determined. Pending requests are absent."),
  "lca-disclosure":
    measured("Certified and denied H-1B labor condition applications only, with the wage offered."),
  "h2a-disclosure":
    measured("Decided H-2A applications only, with the wage offered, the workers requested and certified, and the work period. Pending applications are absent."),
  "h2b-disclosure":
    measured("Decided H-2B applications only, with the wage offered, the workers requested and certified, and the work period. Pending applications are absent."),
  "cw1-disclosure":
    measured("Decided CW-1 applications in the Northern Mariana Islands only, with the wage offered and the workers requested and certified. Pending applications are absent."),
  "daily-decisions":
    measured("Derived from decided cases, so it counts determinations DOL issued, never cases waiting."),
  entities:
    measured("Employers, law firms and occupations ranked from decided cases only."),
  "stage-cohorts":
    measured("Filing-month durations over decided cases. The live sweep supplies how much of each month is still pending."),
  "nvc-timeframes":
    official("The National Visa Center's own weekly figures: how far behind it creates cases and reviews documents. Not a wait for any one case, and nothing about the consulate's interview."),
  "perm-pwd-links":
    measured("Decided PERM cases joined to the wage request each names, for wage requests determined long enough ago that their PERMs have been decided. A PERM still pending isn't counted."),

  // --- our own live sweep of DOL: pending included ------------------------
  "perm-case-status":
    measured("Every PERM case DOL indexes, pending included. No wage, law firm or worksite: DOL reveals those only when a case is published."),
  "perm-case-status-full":
    measured("The same live record, re-checked in full rather than only the pending half."),
  "pwd-status":
    measured("Live status of prevailing wage requests, pending included. The wage itself isn't here. It arrives with the quarterly file."),
  "lca-status":
    measured("Live status of H-1B labor condition applications, pending included."),
  "seasonal-postings":
    measured("H-2A and H-2B applications and H-2A job orders DOL accepted, with the wage, workers, work period and worksite, from SeasonalJobs.dol.gov, accepted since February 6, 2024. The decision isn't here. It comes from the live status and, later, the quarterly file."),
  "seasonal-status":
    measured("Live status of H-2A, H-2B and CW-1 applications, H-2A job orders, and H-2B and CW-1 prevailing wage requests, pending included. No wage or worksite: those come from the quarterly files and SeasonalJobs."),
  "live-recent":
    measured("The cases our sweep knows that DOL hasn't published yet, so they can be found by employer before any file lists them."),
  "decisions-observed":
    measured("Status changes our sweep watched happen, from 26 August 2026 onward. Nothing earlier: DOL publishes a case's current status, never when it changed."),
  "review-stages":
    measured("How many pending cases sit at each review stage right now, counted live."),
  "rfi-funnel":
    measured("RFI outcomes, blended from a frozen third-party window and our own observations, pooled as counts."),

  // --- DOL's own published position ---------------------------------------
  "processing-times":
    official("DOL's published queue position and average determination time, as DOL computes them."),

  // --- other federal sources ----------------------------------------------
  "visa-bulletin":
    official("Cutoff dates as the State Department published them each month. Nothing here is forecast."),
  "visa-wait-times":
    official("The wait for a NONIMMIGRANT visa interview at each U.S. embassy and consulate, as State's Global Visa Wait Times table prints it each month: the next appointment for visitors, students, petition-based workers (H, L, O, P, Q) and crew, and visitors' average wait. Interview waivers aren't in it, and neither is the immigrant visa (green card) interview."),
  "nvc-waiting-list":
    official("State's yearly count, each November 1 since 2016, of applicants waiting for an immigrant visa at the National Visa Center. It's by category, with spouses and children included. It covers consular cases only, so adjustments at USCIS aren't in it."),
  "visa-annual-limits":
    official("The State Department's annual numerical limits and the prior year's usage."),
  "uscis-case-status":
    official("USCIS's own case status text and dated history for a receipt number, read from its Case Status API at lookup time and kept twelve months after the last lookup. Nothing is estimated."),
  "i485-inventory":
    official("USCIS's count of pending I-485s by priority date and country. Employment-based only: USCIS doesn't publish a family-based equivalent."),
  "uscis-monthly-forms":
    official("USCIS's monthly report to Congress: receipts, approvals, denials and pending for six forms, the I-485 split by basis. Its average processing time counts every case finished that month and isn't the 8-in-10 time USCIS posts, and USCIS revises past months."),
  "uscis-i140-counts":
    official("USCIS I-140 receipts, approvals and denials by quarter. A denial here isn't a PERM denial. It comes from a different agency at a different stage."),
  "uscis-i140-times":
    official("USCIS's published I-140 processing times, its own service-centre figures. This site measures none of them."),
  "i140-trends":
    official("I-140 volumes by fiscal quarter and classification, as USCIS publishes them. Counts of filings. They don't count the people waiting."),
  debarments:
    official("Employers and agents DOL has barred, for the period DOL states. Includes bars that haven't started yet."),
  "policy-notices":
    official("Federal Register rules, proposed rules, notices and presidential documents that touch these programs, with the Register's own dates. Not guidance or internal memos."),
  "policy-notices-oflc":
    official("Every announcement OFLC posts on its own page, H-2A, H-2B and CW-1 included, which is where program changes appear before the Federal Register."),
  "policy-notices-dol":
    official("DOL's news releases on foreign labor and work visas (H-1B, PERM, H-2A, H-2B, Project Firewall), from its newsroom. The rest of DOL's news is left out."),
  "policy-notices-pi":
    official("Today's Federal Register public inspection list, kept by the policy feed's rules on the title: documents the Register files the business day before it publishes them, followed until published or withdrawn. No abstract until publication."),
  "policy-notices-wh":
    official("The White House's presidential actions on an immigration subject, the day they're posted, from its own feed. Replaced by the Federal Register's document once published. Nothing on other subjects."),
  "policy-notices-uscis":
    official("USCIS's news releases and alerts on work-based immigration, from its newsroom feed. Fraud cases, naturalization and humanitarian-only items are left out."),
  "policy-comments":
    official("How many comments regulations.gov has posted on each proposed rule still open for comment. It counts posted comments. An agency posts a comment after screening it, so the count trails what was sent."),
  "policy-notices-congress":
    official("Bills and joint resolutions in the current Congress whose titles name a work-visa or employment-based green card subject, with each bill's latest action. Resolutions and bills on other subjects are left out."),
  "policy-notices-courts":
    official("Federal court opinions that turn on PERM labor certification, H-1B, H-2A, H-2B, I-140 or employment-based green cards, from CourtListener's archive, with a person named in a caption shown by initials. State courts, criminal cases and petitions for review of removal orders are left out."),
  "policy-notices-dockets":
    official("The filings in a few court cases this site follows by name (scripts/data/court_dockets.json), from CourtListener's RECAP archive: opinions, judgments, rulings on a stay or an injunction, notices of appeal, and the government's status reports and sworn declarations. Each is named by its kind. An entry's own words, which name people, are never shown."),
  "policy-notices-balca":
    official("BALCA's decisions as OALJ lists them: every en banc PERM decision, and prevailing wage, H-2A and H-2B appeals decided since October 2024, with a sole proprietor shown by initials. OALJ keeps no list of ordinary PERM panel decisions, and its lists run weeks to months behind."),
  "policy-notices-doj":
    official("The Justice Department's actions against work-visa sponsors since January 2025. They include Civil Rights Division releases that name H-1B, H-2A, PERM or a job held for a visa worker. They also include the Immigrant and Employee Rights Section's settlements that have no release, and OCAHO cases the government brought against a company IER names. Document-demand settlements and every case about a person are left out."),
  "policy-notices-embassies":
    official("The visa notices of the 20 U.S. embassies whose posts issued the most employment-based immigrant visas from March 2025 to February 2026, from each embassy's own Visas feed, read in a browser once a day: consular operations updates, interviews paused or resumed, appointments cancelled, and immigrant visa processing. Checklists, scam warnings, health alerts and visitor or student notices are left out, and a feed holds only an embassy's newest ten posts."),
  "policy-notices-state":
    official("The State Department's visa news on work and immigrant visas, from its own newsroom. Visitor-only, diversity-lottery, passport and adoption items are left out."),
  "policy-notices-uscis-pm":
    official("Every Policy Manual alert and technical update on the work-based parts of the manual since 2013, with the sections each one changed."),
  "rule-pipeline-agenda":
    official("Each agency's Unified Agenda listing for USCIS rules and immigration rules from DOL, State and DHS: the stage, the agency's own timetable for its next step as printed, and the abstract, from reginfo.gov's file for the newest edition. The timetable is the agency's plan. This site doesn't predict the date."),
  "rule-pipeline":
    official("Rules from USCIS, and immigration rules from DOL, State and DHS, from White House review (OIRA's own lists) through public inspection to the Federal Register. A rule OIRA doesn't review appears once it's on public inspection."),
  "whd-cases":
    official("The Labor Department's concluded Wage and Hour compliance actions since FY2005, as DOL publishes them: violations, back wages the employer agreed to pay, workers owed and penalties, H-1B, H-2A and H-2B counted apart. Kept here are the cases matched to an employer page by legal name, and every case with an H-1B, H-2A or H-2B finding."),
  "osha-inspections":
    official("Workplace safety and health inspections by OSHA and the state plans, opened since October 2016 and matched to a PERM sponsor's page by name. Each shows why it was opened and when it opened and closed. Its violations are listed with their type and penalty, counted as OSHA counts them. An open inspection's citations can still change."),
  "uscis-posted-times":
    official("Every figure USCIS's processing-times page has posted since March 2022, by form, subtype and office, with USCIS's own posting date: the time it took to decide 80% of the cases it decided in the past six months. An open-source project copies USCIS's page each day, and this site checks it against a weekly reading of the page itself."),
  "ppp-loans":
    official("SBA's Paycheck Protection Program loans from 2020 and 2021, as SBA released them (its snapshot of September 30 2024): the amount approved and forgiven and the jobs the borrower reported then. Only loans matched to a PERM sponsor's page by name and city are kept. Loans to people (sole proprietors, the self-employed) are never kept."),
  "taa-petitions":
    official("DOL's Trade Adjustment Assistance petitions decided from October 2012 to June 2022, when the program stopped: groups of workers DOL certified, or didn't, as losing their jobs to imports or work moved abroad. Kept here are petitions matched to a PERM sponsor's page by name and city, with DOL's own determination codes."),
  "sam-exclusions":
    official("Firms the federal government has excluded from contracts and certain assistance, from SAM.gov's daily public file: the excluding agency, the kind of exclusion and its dates. Only firms matched to a PERM sponsor's page by name and state are kept. People and vessels are never kept."),
  "warn-notices":
    official("State WARN layoff notices from 47 states and DC, each from the record its state publishes. Arkansas, New Hampshire and Wyoming publish no list."),
  "warn-notices-ca":
    official("California WARN notices, from the state's own spreadsheet. A notice records a layoff the employer announced, and it doesn't confirm that the layoff happened."),
  "warn-notices-ny":
    official("New York WARN notices, taken from the state's dashboard export rather than its older HTML list."),
  "warn-notices-tx":
    official("Texas WARN notices from the agency's spreadsheet, read from the Internet Archive's copy because the agency's site challenges scripts, and from the state open data portal back to 2019."),
  "warn-notices-wa":
    official("Washington WARN notices, read a page at a time from the state's own searchable database."),
  "warn-notices-al": official("Alabama WARN notices from the Department of Workforce's list, since 2019."),
  "community-sheet-sfv-filers":
    community("The San Fernando Filers sheet, a public Google Sheet people keep their own I-485 cases in at USCIS's San Fernando Valley field office, read every hour. Self-reported and unchecked; the usernames and receipt numbers stay in the sheet."),
  "community-visastats":
    community("VisaStats' community tracker of self-reported EB-2 NIW, EB-1A and O-1 I-140 cases and its RFE officer lookup, copied in a browser each week (its robots.txt closes its API). Its policy allows copying; the author aliases and free text aren't shown."),
  "reported-cases":
    community("Every case people reported themselves, from the community sheets, VisaStats' tracker and the posts this site reads, merged so each person is one case: two reports join only when three of their dates match and nothing contradicts. Unchecked, and only as complete as what people chose to share."),
  "community-posts-reddit":
    community("People's own case dates from Reddit posts and comments, read every day: only the dates and categories, never a username, a quote or a link. Unchecked, and only as complete as what people posted."),
  "community-posts-telegram":
    community("People's own case dates from public Telegram groups about PERM and green cards, read every hour: only the dates, categories and offices, never a name, a username or a message's words. Read by a parser and a small model, every date checked against what the post itself writes. Unchecked, and only as complete as what people posted."),
  "community-posts-whatsapp":
    community("People's own case dates from WhatsApp groups about green cards, from chats exported with WhatsApp's own Export Chat button: only the dates, categories and offices are kept, never a name, a phone number or a message's words. Read by the same parser and small model as the Telegram posts. Unchecked, and only as complete as the chats exported."),
  "community-posts-facebook":
    community("People's own case dates from public Facebook groups about H-1B visas and green cards, typed in by hand from posts shared with us: only the dates, categories, offices and country, never a name, a username, a link or a post's words. No script reads Facebook. Unchecked, and only as complete as the posts shared."),
  "warn-notices-ak": official("Alaska WARN notices from the Department of Labor's list, since 2019."),
  "warn-notices-az":
    official("Arizona WARN notices from the state's job-center search, since 2019. Counts come from each notice's own page, newest first: a run reads the new ones, and the state's weekly read fills the rest, so an older notice can wait up to a week for its count."),
  "warn-notices-co":
    official("Colorado WARN notices from the state's yearly sheets, since 2019, counting the workers in Colorado where the sheet says so."),
  "warn-notices-ct": official("Connecticut WARN notices from the Department of Labor's document library, since 2019."),
  "warn-notices-dc": official("District of Columbia WARN notices from the yearly pages DOES posts, since 2021."),
  "warn-notices-de":
    official("Delaware WARN notices from the state's job-center search, since 2019. Counts come from each notice's own page, newest first: a run reads the new ones, and the state's weekly read fills the rest, so an older notice can wait up to a week for its count."),
  "warn-notices-fl": official("Florida WARN notices from FloridaCommerce's list for each year, since 2019."),
  "warn-notices-ga": official("Georgia WARN notices from WorkSource Georgia's list, since 2023, dated by the day each was submitted."),
  "warn-notices-hi":
    official("Hawaii WARN notices since 2020. Notices from August 2026 carry their counts. Earlier ones are letters, so they carry the company and date only."),
  "warn-notices-ia": official("Iowa WARN notices from the state's WARN log, since October 2021. An amendment is its own row."),
  "warn-notices-id":
    official("Idaho WARN notices from the state's list, since 2019, counting Idaho's share where a notice covers several states."),
  "warn-notices-il":
    official("Illinois WARN notices from the state's layoff database, since 2019. Layoffs the database marks as not WARN notices are left out."),
  "warn-notices-in": official("Indiana WARN notices from the Department of Workforce Development's list, since 2019."),
  "warn-notices-ks":
    official("Kansas WARN notices from the state's job-center search, since 2019. Kansas posts few, so months can pass with none. Counts come from each notice's own page, newest first: a run reads the new ones, and the state's weekly read fills the rest, so an older notice can wait up to a week for its count."),
  "warn-notices-ky": official("Kentucky WARN notices from this year's report and the prior-year workbook, since 2019."),
  "warn-notices-ma":
    official("Massachusetts WARN notices from the State Library's copy of the weekly report, since July 2020. Earlier years are in a format the loader can't read."),
  "warn-notices-md": official("Maryland WARN notices from the Department of Labor's page for each year, since 2019."),
  "warn-notices-me": official("Maine WARN notices from the state's job-center search, since 2019. Counts come from each notice's own page, newest first: a run reads the new ones, and the state's weekly read fills the rest, so an older notice can wait up to a week for its count."),
  "warn-notices-mi": official("Michigan WARN notices from the state's list, since November 2024, dated by the day the state posted each."),
  "warn-notices-ms":
    official("Mississippi WARN notices from the quarterly reports, since July 2020. Notices the state marks as not required by the WARN Act are left out."),
  "warn-notices-mt": official("Montana WARN notices from the Department of Labor and Industry's workbook, since 2019."),
  "warn-notices-nc":
    official("North Carolina WARN notices since 2019: this year from the state's dashboard, earlier years from its yearly reports, dated by the day the state received each."),
  "warn-notices-nd": official("North Dakota WARN notices from Job Service's list, since 2019. The state updates it a few times a year."),
  "warn-notices-ne": official("Nebraska WARN notices from the Department of Labor's list, since March 2023."),
  "warn-notices-nj":
    official("New Jersey WARN notices from the state's archive, since 2019. It prints only the month a notice was posted, so the month is shown."),
  "warn-notices-oh": official("Ohio WARN notices from this year's list on the state's page. Earlier years aren't read."),
  "warn-notices-ok": official("Oklahoma WARN notices, since 2019. Oklahoma prints no worker count, so none is shown."),
  "warn-notices-or": official("Oregon WARN notices from the state's Rapid Response list, since late 2020."),
  "warn-notices-pa":
    official("Pennsylvania WARN notices, since 2023. The state lists each only by the month it was posted. A notice for several sites is a row per site."),
  "warn-notices-sc": official("South Carolina WARN notices from the yearly reports, since 2022. Earlier reports print no notice date."),
  "warn-notices-sd": official("South Dakota WARN notices, since 2019, dated by the day the state received each. No layoff date is printed."),
  "warn-notices-tn": official("Tennessee WARN notices from the state's current page, dated by the day the state posted each."),
  "warn-notices-ut": official("Utah WARN notices from the state's yearly tables, since 2019. No layoff date is printed."),
  "warn-notices-va": official("Virginia WARN notices from Virginia Works's list, since 2019."),
  "warn-notices-vt": official("Vermont WARN notices from the state's job-center search, since 2019. Counts come from each notice's own page, newest first: a run reads the new ones, and the state's weekly read fills the rest, so an older notice can wait up to a week for its count."),
  "warn-notices-wi": official("Wisconsin WARN notices, since 2020. Original notices only: the state's updates to a notice aren't read."),
  "warn-notices-mn":
    official("Minnesota WARN notices since 2023 from DEED's list, by the date DEED prints. The list gives no count, so none is shown. When DEED's page turns a script away, this site reads the Internet Archive's copy instead."),
  "warn-notices-ri":
    official("Rhode Island WARN notices from DLT's workbook, since 2019. Where a notice covers several states, Rhode Island's share is kept."),
  "warn-notices-la":
    official("Louisiana WARN notices from the Workforce Commission's yearly files, since 2019, read from the Internet Archive's copies because the state asks automated readers to stay off its files."),
  "warn-notices-nm":
    official("New Mexico WARN notices from Workforce Solutions' yearly files, since 2024, read from the Internet Archive's copies because the state asks automated readers to stay off its files. The Archive captures them a few times a year."),
  "warn-notices-mo":
    official("Missouri WARN notices from the Office of Workforce Development's yearly pages, since 2019, read from the Internet Archive's copies because each page sits behind a browser check."),
  "warn-notices-nv":
    official("Nevada WARN notices from DETR's yearly lists, since 2022, read from the Internet Archive's copies because the state's site refuses scripts. Notices DETR marks as not required by the WARN Act are left out."),
  "warn-notices-wv":
    official("West Virginia WARN notices since 2021: January 2022 to January 2025 from the state's compiled list, and the rest from each notice's letter, which gives the company and the day or month but no count."),

  // --- USCIS quarterly performance workbooks --------------------------------
  "uscis-form-quarters":
    official("Every USCIS form's receipts, approvals, denials, pending count and MEDIAN months to a decision, per quarter, as USCIS publishes them. The median isn't the 80th-percentile figure on USCIS's processing-times page."),
  "uscis-i485-offices":
    official("I-485 applications received, approved, denied and pending at each USCIS field office and service center in the quarter, by category. Cells USCIS withholds as too small are left blank, never zero."),
  "uscis-eb-awaiting-visa":
    official("Approved I-140, I-360 and I-526 petitions whose beneficiary is still waiting for a visa number. They're counted by preference and country of birth, as of the month USCIS states. Primary beneficiaries only, with dependents excluded."),
  "uscis-i140-class-country":
    official("I-140 petitions by the fiscal year USCIS received them and their current status, all countries and the top five, with approvals by class. Counted by filing year, so a recent year is mostly still pending."),
  "uscis-i765-categories":
    official("Work permit applications (I-765) USCIS received, approved, denied and had pending in the quarter, by eligibility category, such as (c)(9) for people with a green card application pending and (c)(26) for H-4 spouses. First applications, renewals and replacements are counted apart, quarterly from October 2024."),
  "uscis-i765-pending-days":
    official("Pending work permit applications (I-765) by how many days they had waited on the quarter's last day, for every category and for asylum applicants alone, first applications and renewals apart. USCIS counts these from a different system than the category figures, so the two totals never quite match."),
  "uscis-net-backlog":
    official("USCIS's net backlog by form at the quarter's end: cases pending longer than USCIS's own target time, less those waiting on the applicant (an evidence request or a notice of intent to deny) or on a visa number. The backlog figures are rounded to the hundred, and the frontlog of applications not yet opened sits beside them."),
  "uscis-i907-premium":
    official("Premium processing requests (I-907) USCIS received in the quarter, by the form they were for, filed with the petition or added to one already pending. These are requests only, with no decisions or processing times."),
  "uscis-n400-offices":
    official("Naturalization applications (N-400) received, approved, denied and pending at each USCIS field office in the quarter, civilian and military apart. Cells USCIS withholds as too small are left blank."),
  "uscis-rfe":
    official("I-129 petitions USCIS decided each month from FY2015, by visa, and how many of them had a request for evidence. It covers initial decisions only, and a petition with several RFEs is counted once. There are no figures for the I-140, the I-485 or any employer."),
  // --- ICE SEVIS by the Numbers -------------------------------------------------
  "sevp-top-employers":
    official("The 200 employers with the most F-1 students on OPT or STEM OPT, and on CPT, for each year ICE published a list, under ICE's own employer names. Top 200 only. A student in two programs at one employer is counted in each."),
  // --- what a job is, pays and costs where it is (added Oct 5 2026) -----------
  onet:
    official("O*NET's account of each occupation: its description, tasks, Job Zone and the education workers report. It describes the job in general. It doesn't describe any one employer's opening."),
  "bls-oews":
    official("Pay employers report for everyone in each job, from BLS's yearly survey (May of the year named). It's shown nationally, by state and by metro. It covers citizens and immigrants alike, and it isn't drawn from PERM offers."),
  "bls-projections":
    official("BLS's ten-year projection of each job's employment and yearly openings, and the entry education it calls typical. Each figure is a projection."),
  "oflc-wage-levels":
    official("The four prevailing wage levels DOL publishes for every job in every area, each wage year from 2021-22, as DOL's own tables print them. They're the floors an offer is held to. They don't show what anyone was paid."),
  "census-geo":
    official("Where each worksite city sits: its county, metro area and DOL wage area, matched to Census's place and county files. A city Census lists in no single place is left unmatched. This site doesn't guess it."),
  "bea-rpp":
    official("BEA's regional price parities: what the same basket costs in a state or metro area against the national level of 100."),
  "visa-issuances":
    official("Immigrant visas State's consulates issued abroad each month, by visa class and by country or consulate. A green card granted inside the United States (adjustment of status at USCIS) isn't in it. For employment categories, that's most of them."),
  "niv-issuances":
    official("Nonimmigrant visas each US consulate issued each month, by visa class (H-1B, L-1, K-1 fiancé(e), visitors, students and the rest), from State's monthly tables, which State calls preliminary. Visas only: a change of status inside the United States isn't in it, and neither are refusals. Each month is checked against State's own grand total."),
  "visa-refusals":
    official("Visa applications consular officers found ineligible each fiscal year, by ground of the law, from State's yearly Report of the Visa Office. It also shows how many findings were overcome, with immigrant and nonimmigrant visas kept apart. Worldwide only: State publishes no count by consulate or month. An application can be refused on several grounds, and a refusal overcome in a later year counts in that year."),
  "iv-scheduling":
    official("For each US consulate, the month of documentarily complete cases the National Visa Center is scheduling interviews for, as State's IV Scheduling Status Tool printed it at each monthly update. It covers employment, family preference and immediate relative cases. It's NVC's paperwork queue, so it doesn't show an interview wait or whether a post is holding interviews. Copied in a browser, since State's site refuses scripts."),
  // --- USCIS H-1B Employer Data Hub -------------------------------------------
  "uscis-h1b-hub":
    official("H-1B workers USCIS approved and denied per petitioner from FY2009, by the fiscal year of its FIRST decision. Appeals, revocations and pending petitions are excluded. The address is the petitioner's mailing address, which doesn't show where the work is."),
  // --- Firm page claims ----------------------------------------------------------
  "firm-email-domains":
    measured("The email DOMAINS DOL's newest PERM, wage-request and LCA files print beside each law firm, used only to check a claim on the firm's page. Never an address. Personal mail and domains shared by many firms are left out."),
};

/**
 * A news feed: its row's date is the newest item's day, while the reader runs every half hour, so its source line
 * says when we checked it and the newest item beside it (a quiet feed isn't a stale one). The Federal Register,
 * agency newsrooms, courts, BALCA, DOJ, bills and the rule pipeline; not the comment counts, dated by their check.
 */
export function isNewsFeed(dataset: string): boolean {
  return /^(policy-notices|rule-pipeline)/.test(dataset);
}

/** The coverage sentence for a dataset, or null when nobody has written one. */
export function coverageFor(dataset: string): string | null {
  return DATASET_COVERAGE[dataset]?.text ?? null;
}

/** The kind of source a dataset is, or null for a dataset with no row. */
export function datasetKind(dataset: string): SourceKind | null {
  return DATASET_COVERAGE[dataset]?.kind ?? null;
}

/**
 * The short name each dataset goes by on a page's source lines. Every dataset
 * in DATASET_COVERAGE needs one (dataset-coverage.test.ts): without it the
 * line printed the registry id, "h2a-disclosure:", to readers.
 */
export const DATASET_LABELS: Readonly<Record<string, string>> = {
  ...SHEET_LABELS,
  "perm-cases": "Case data",
  "pw-disclosure": "Wage determinations",
  "lca-disclosure": "LCA disclosures",
  "h2a-disclosure": "H-2A disclosures",
  "h2b-disclosure": "H-2B disclosures",
  "cw1-disclosure": "CW-1 disclosures",
  "daily-decisions": "Daily decisions",
  entities: "Employers and firms",
  "stage-cohorts": "Cases by stage",
  "perm-pwd-links": "Wage request to PERM",
  "nvc-timeframes": "NVC timeframes",
  "perm-case-status": "Per-case statuses",
  "perm-case-status-full": "Per-case statuses, full sweep",
  "pwd-status": "Wage request statuses",
  "lca-status": "LCA statuses",
  "seasonal-postings": "SeasonalJobs.dol.gov postings",
  "seasonal-status": "H-2A, H-2B and CW-1 statuses",
  "live-recent": "Live PERM filings",
  "decisions-observed": "Decisions we observed",
  "review-stages": "Review stages",
  "rfi-funnel": "RFI and audit outcomes",
  "processing-times": "Processing times",
  "visa-bulletin": "Visa bulletin",
  "visa-wait-times": "State visa wait times",
  "nvc-waiting-list": "NVC waiting list",
  "visa-annual-limits": "Annual visa limits",
  "uscis-case-status": "USCIS case statuses",
  "i485-inventory": "I-485 pending inventory",
  "uscis-monthly-forms": "USCIS monthly form counts",
  "uscis-i140-counts": "I-140 counts",
  "uscis-i140-times": "I-140 times",
  "i140-trends": "I-140 filings by category",
  debarments: "DOL debarment lists",
  "policy-notices": "Federal Register notices",
  "policy-notices-oflc": "OFLC announcements",
  "policy-notices-dol": "DOL news releases",
  "policy-notices-pi": "Federal Register public inspection",
  "policy-notices-wh": "White House presidential actions",
  "policy-notices-uscis": "USCIS news and alerts",
  "policy-notices-uscis-pm": "USCIS Policy Manual updates",
  "policy-notices-state": "State Department visa news",
  "policy-notices-doj": "Justice Department actions",
  "policy-notices-embassies": "U.S. embassies' visa notices",
  "policy-comments": "Comment counts from regulations.gov",
  "policy-notices-congress": "Bills in Congress",
  "policy-notices-courts": "Federal court opinions",
  "policy-notices-dockets": "Filings in followed court cases",
  "policy-notices-balca": "BALCA decisions",
  "rule-pipeline": "Rules in review and on public inspection",
  "rule-pipeline-agenda": "The Unified Agenda",
  "whd-cases": "Wage and Hour cases",
  "osha-inspections": "OSHA inspections",
  "uscis-posted-times": "USCIS posted processing times",
  "sam-exclusions": "SAM.gov exclusions",
  "taa-petitions": "Trade Adjustment Assistance petitions",
  "ppp-loans": "Paycheck Protection Program loans",
  "warn-notices": "WARN notices",
  "warn-notices-ca": "California WARN notices",
  "warn-notices-ny": "New York WARN notices",
  "warn-notices-tx": "Texas WARN notices",
  "warn-notices-wa": "Washington WARN notices",
  "warn-notices-al": "Alabama WARN notices",
  "community-sheet-sfv-filers": "The San Fernando Filers sheet",
  "community-visastats": "VisaStats' community tracker",
  "reported-cases": "Cases people reported, merged",
  "community-posts-reddit": "Reddit posts and comments",
  "community-posts-telegram": "Telegram groups' posts",
  "community-posts-facebook": "Facebook groups' posts, typed in by hand",
  "community-posts-whatsapp": "WhatsApp groups' posts, exported by hand",
  "warn-notices-ak": "Alaska WARN notices",
  "warn-notices-az": "Arizona WARN notices",
  "warn-notices-co": "Colorado WARN notices",
  "warn-notices-ct": "Connecticut WARN notices",
  "warn-notices-dc": "District of Columbia WARN notices",
  "warn-notices-de": "Delaware WARN notices",
  "warn-notices-fl": "Florida WARN notices",
  "warn-notices-ga": "Georgia WARN notices",
  "warn-notices-hi": "Hawaii WARN notices",
  "warn-notices-ia": "Iowa WARN notices",
  "warn-notices-id": "Idaho WARN notices",
  "warn-notices-il": "Illinois WARN notices",
  "warn-notices-in": "Indiana WARN notices",
  "warn-notices-ks": "Kansas WARN notices",
  "warn-notices-ky": "Kentucky WARN notices",
  "warn-notices-ma": "Massachusetts WARN notices",
  "warn-notices-md": "Maryland WARN notices",
  "warn-notices-me": "Maine WARN notices",
  "warn-notices-mi": "Michigan WARN notices",
  "warn-notices-ms": "Mississippi WARN notices",
  "warn-notices-mt": "Montana WARN notices",
  "warn-notices-nc": "North Carolina WARN notices",
  "warn-notices-nd": "North Dakota WARN notices",
  "warn-notices-ne": "Nebraska WARN notices",
  "warn-notices-nj": "New Jersey WARN notices",
  "warn-notices-oh": "Ohio WARN notices",
  "warn-notices-ok": "Oklahoma WARN notices",
  "warn-notices-or": "Oregon WARN notices",
  "warn-notices-pa": "Pennsylvania WARN notices",
  "warn-notices-sc": "South Carolina WARN notices",
  "warn-notices-sd": "South Dakota WARN notices",
  "warn-notices-tn": "Tennessee WARN notices",
  "warn-notices-ut": "Utah WARN notices",
  "warn-notices-va": "Virginia WARN notices",
  "warn-notices-vt": "Vermont WARN notices",
  "warn-notices-wi": "Wisconsin WARN notices",
  "warn-notices-mn": "Minnesota WARN notices",
  "warn-notices-ri": "Rhode Island WARN notices",
  "warn-notices-la": "Louisiana WARN notices",
  "warn-notices-nm": "New Mexico WARN notices",
  "warn-notices-mo": "Missouri WARN notices",
  "warn-notices-nv": "Nevada WARN notices",
  "warn-notices-wv": "West Virginia WARN notices",
  "uscis-form-quarters": "USCIS quarterly form data",
  "uscis-i485-offices": "I-485 by field office",
  "uscis-eb-awaiting-visa": "Petitions awaiting a visa",
  "uscis-i140-class-country": "I-140 by class and country",
  "uscis-i765-categories": "I-765 by eligibility category",
  "uscis-i765-pending-days": "Pending I-765s by days waited",
  "uscis-net-backlog": "USCIS net backlog",
  "uscis-i907-premium": "Premium processing requests",
  "uscis-n400-offices": "N-400 by field office",
  "uscis-rfe": "USCIS I-129 requests for evidence",
  "sevp-top-employers": "ICE top OPT and CPT employers",
  "uscis-h1b-hub": "USCIS H-1B Employer Data Hub",
  onet: "O*NET occupation data",
  "bls-oews": "BLS market pay",
  "bls-projections": "BLS employment projections",
  "oflc-wage-levels": "DOL wage tables",
  "census-geo": "Census places and metros",
  "bea-rpp": "BEA price parities",
  "visa-issuances": "State visa issuances",
  "niv-issuances": "State nonimmigrant visa issuances",
  "visa-refusals": "State visa refusals by ground",
  "iv-scheduling": "State's IV scheduling table",
  "firm-email-domains": "Law firms' email domains",
  // Retired names still stamped on older rows.
  "perm-month-stats": "Pending case counts",
};

/** A dataset's short name, or the id itself when none is written (a test keeps that from shipping). */
export function datasetLabel(dataset: string): string {
  return DATASET_LABELS[dataset] ?? dataset;
}
