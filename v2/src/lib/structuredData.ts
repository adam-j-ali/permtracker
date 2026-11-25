/**
 * Structured Data (JSON-LD) generators for SEO
 *
 * Provides type-safe schema generators for:
 * - SoftwareApplication (the app, whole with its rating, on the homepage only)
 * - Organization (site publisher info, on every page)
 * - WebSite (site name for Google Search, on every page)
 * - FAQPage (kept for non-Google engines; Google dropped FAQ rich results
 *   in May 2026, so this is no longer a rich-result lever there)
 *
 * THE DESCRIPTIONS HERE ARE WHAT ANSWER ENGINES QUOTE. LLM retrieval
 * tokenizes JSON-LD as text, so the description strings below are read
 * exactly like visible copy - and for months they said "for immigration
 * attorneys", which is precisely what AI overviews then said the whole
 * product was. Both sides of the product, in both descriptions, always.
 */

import {
  DISAMBIGUATION,
  FOUNDED,
  LEGAL_NAME,
  ORGANIZATION_DESCRIPTION,
  ORGANIZATION_SAME_AS,
  PEOPLE,
  POSTAL_ADDRESS_PARTS,
} from './constants/about';

/** The other names the site goes by: the WebSite node (Google's site name) and the Organization share them. */
const ALTERNATE_NAMES = ['PERMTracker', 'permtracker.app'];

/**
 * Single source for the schema.org `@id` fragments used to cross-link entities
 * in the root layout's `@graph`. Keep these in sync with the consumers in
 * src/app/layout.tsx, referencing this helper instead of inlining the
 * `${baseUrl}/#x` template literal everywhere prevents drift across files.
 */
export const SCHEMA_IDS = {
  software: (baseUrl: string) => `${baseUrl}/#software` as const,
  organization: (baseUrl: string) => `${baseUrl}/#organization` as const,
  website: (baseUrl: string) => `${baseUrl}/#website` as const,
} as const;

/**
 * The app's category, from the 22 values Google accepts ("The value must be a
 * supported app type", developers.google.com/search/docs/appearance/
 * structured-data/software-app, read Oct 7 2026). It said 'WebApplication',
 * which is a schema.org type and not on that list. ReferenceApplication: the
 * public half is case lookups and DOL's data, and BusinessApplication would
 * describe only the attorney half. Both nodes sharing the app's @id read it.
 */
export const GOOGLE_APP_CATEGORIES = [
  'GameApplication', 'SocialNetworkingApplication', 'TravelApplication', 'ShoppingApplication',
  'SportsApplication', 'LifestyleApplication', 'BusinessApplication', 'DesignApplication',
  'DeveloperApplication', 'DriverApplication', 'EducationalApplication', 'HealthApplication',
  'FinanceApplication', 'SecurityApplication', 'BrowserApplication', 'CommunicationApplication',
  'DesktopEnhancementApplication', 'EntertainmentApplication', 'MultimediaApplication',
  'HomeApplication', 'UtilitiesApplication', 'ReferenceApplication',
] as const;
const APP_CATEGORY: (typeof GOOGLE_APP_CATEGORIES)[number] = 'ReferenceApplication';

/**
 * The app as one whole SoftwareApplication node, its rating inside it. The homepage alone emits it, and only when
 * `shouldAdvertiseRating` allows (src/app/(site)/(public)/page.tsx).
 *
 * WHY ONLY THERE. Google's Software App feature requires `name`, `offers.price` and an `aggregateRating` or `review`
 * ("You must include one of the following properties", developers.google.com/search/docs/appearance/
 * structured-data/software-app), and its review guidelines want the rating visible on the page that carries it. The
 * rating line shows on the homepage (ReviewsLine). Until Nov 20 2026 the root layout put a rating-less copy of this
 * node on every page and the homepage added a second node with the same `@id` holding the rating; Google may merge
 * the two, but validator.schema.org and Ahrefs read each node alone, so every page failed the rich-result check.
 *
 * WITHOUT ENOUGH REVIEWS no page emits the node at all: a SoftwareApplication without a rating is an item Google's
 * check marks invalid, and nothing else on the site needs the node (other nodes may point at its `@id`).
 */
export function getSoftwareApplicationSchema(baseUrl: string, rating: RatingFields) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication' as const,
    '@id': SCHEMA_IDS.software(baseUrl),
    name: 'PERM Tracker',
    // The same other names as the Organization and the WebSite, so all three say they're one brand.
    alternateName: ALTERNATE_NAMES,
    applicationCategory: APP_CATEGORY,
    operatingSystem: 'Web Browser',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer' as const,
      price: '0',
      priceCurrency: 'USD',
    },
    description:
      'Free labor-certification tracking for green-card applicants and immigration attorneys. Look up a case by number for its live DOL status and a decision estimate, in every DOL program: PERM (G-), prevailing wage request (P-), labor condition application for H-1B, H-1B1 or E-3 (I-200 to I-203) and H-2A, H-2B and CW-1 (H-300/H-400/C-500). With no case number at all, find it by employer name. Follow the queue with live data and compute every case deadline automatically.',
    disambiguatingDescription:
      'Two sides, both free: a public tracker for the person waiting (per-case DOL status, timelines for PWD, PERM, I-140 and I-485, and open datasets), and case-management software for attorneys and firms (deadlines computed per case, reminders, calendar sync).',
    audience: [
      {
        '@type': 'Audience' as const,
        audienceType: 'Green-card applicants and beneficiaries',
      },
      {
        '@type': 'Audience' as const,
        audienceType: 'Immigration attorneys, paralegals and HR teams',
      },
    ],
    url: baseUrl,
    screenshot: `${baseUrl}/opengraph-image`,
    // Cross-reference the Organization @id (set in src/app/layout.tsx where
    // schemas are combined into @graph) instead of inlining a duplicate. Lets
    // Google understand this is the same entity as the Organization schema.
    creator: { '@id': SCHEMA_IDS.organization(baseUrl) },
    featureList: [
      'Per-case PERM status lookup from DOL, with email alerts on changes',
      'Timelines and calculators for PWD, PERM, I-140 and I-485',
      'Live PERM queue data: backlog, pace, employers, law firms, wages',
      'Automatic deadline calculation per DOL regulations',
      'Multi-case management dashboard',
      'Email and push notifications',
      'Calendar view with deadlines',
    ],
    // The same rating the page shows (from getSiteReviews), so the markup and
    // the visible line can't disagree.
    aggregateRating: {
      '@type': 'AggregateRating' as const,
      ratingValue: rating.value,
      // ratingCount, not reviewCount: a rating from an alert email counts, and it has no words (Oct 31 2026).
      ratingCount: rating.count,
      bestRating: rating.best,
      worstRating: rating.worst,
    },
  };
}

/**
 * Generate Organization schema
 * Used to describe the publisher/creator of the site
 */
export function getOrganizationSchema(baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization' as const,
    name: 'PERM Tracker',
    // The entity the Terms bind. One constant feeds this, the About page and
    // the Terms, so the three cannot name different parties.
    legalName: LEGAL_NAME,
    alternateName: ALTERNATE_NAMES,
    description: ORGANIZATION_DESCRIPTION,
    // Tells this site apart from others with similar names (see DISAMBIGUATION).
    disambiguatingDescription: DISAMBIGUATION,
    url: baseUrl,
    logo: `${baseUrl}/icon-512.png`,
    email: 'support@permtracker.app',
    // The LLC's principal and mailing address as filed with Florida; already
    // printed on the Terms, the Privacy Policy and every email.
    address: { '@type': 'PostalAddress' as const, ...POSTAL_ADDRESS_PARTS },
    contactPoint: {
      '@type': 'ContactPoint' as const,
      email: 'support@permtracker.app',
      contactType: 'customer support',
      availableLanguage: ['English'],
    },
    // The site covers the US labor certification and green card process, for
    // people anywhere; "where" for a search engine is the US.
    areaServed: { '@type': 'Country' as const, name: 'United States' },
    // What the site is about, in the words people search: answer engines use
    // these to decide which questions the organization is a source for.
    knowsAbout: [
      'PERM labor certification',
      'Prevailing wage determination',
      'H-1B labor condition application',
      'H-2A and H-2B temporary labor certification',
      'Visa bulletin',
      'Employment-based green card',
      'Form I-140',
      'Form I-485',
    ],
    // Every brand-owned surface that names the brand (Medium, Product Hunt),
    // each verified live. Brand-owned URLs only on the
    // Organization; the person is her own node below, with her own profile,
    // so a personal profile is never asserted as the brand's.
    sameAs: [...ORGANIZATION_SAME_AS],
    // How the figures are made, how mistakes are fixed and who owns the site:
    // schema.org's trust properties on Organization (The Trust Project's),
    // each pointing at a page that already says it. How the figures are
    // checked (/methodology) is one of the publishing principles: schema.org
    // has verificationFactCheckingPolicy on NewsMediaOrganization only, and on
    // Organization it was an unknown property on every page (validator.schema.org,
    // Nov 20 2026). scripts/data/schema_org_properties.json holds what each type allows.
    publishingPrinciples: [`${baseUrl}/editorial-standards`, `${baseUrl}/methodology`],
    correctionsPolicy: `${baseUrl}/changelog/corrections`,
    ownershipFundingInfo: `${baseUrl}/about`,
    actionableFeedbackPolicy: `${baseUrl}/contact`,
    // Registration month of the domain (RDAP). Google's site-names doc counts
    // "web references" and the home page's own text among the sources it
    // corroborates a name against; a founding date and named founders are the
    // two facts an About page carries that a product page does not.
    foundingDate: FOUNDED,
    founder: PEOPLE.map((p) => ({
      '@type': 'Person' as const,
      '@id': `${baseUrl}/about#${p.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      name: p.name,
      jobTitle: p.jobTitle,
      image: `${baseUrl}${p.image}`,
      sameAs: [...p.sameAs],
    })),
  };
}

/**
 * Generate WebSite schema for search features
 */
export function getWebSiteSchema(baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite' as const,
    name: 'PERM Tracker',
    // The lowercase domain is here DELIBERATELY. Listing the URL form is not
    // what makes Google print the URL; Google's site-names doc says the
    // opposite, verbatim - "Provide your domain or subdomain name as a backup
    // option. To provide your domain or subdomain as a backup option, add your
    // domain or subdomain name as your alternative name" - and "Your domain or
    // subdomain needs to be in all lowercase ... for our system to detect this
    // as a site name preference." It is a documented fallback, not a cause.
    //
    // When Google declines the primary name it prints the domain anyway, so
    // listing "permtracker.app" beside "PERMTracker" only changes WHY the
    // domain shows - a detected preference rather than a fallthrough - and
    // gives the system a legal second choice.
    //
    // It declines it for two documented reasons, neither fixable by markup:
    // "PERM Tracker" is generic (it IS the search query), and another site
    // declares the byte-identical string, while Google "generally won't use the
    // same site name for two different sites."
    alternateName: ALTERNATE_NAMES,
    url: baseUrl,
    description:
      'Free PERM tracking for green-card applicants and immigration attorneys: live DOL data, per-case status, and automatic deadlines.',
    // Cross-reference Organization @id (set in src/app/layout.tsx @graph) so
    // Google understands WebSite is published by the Organization entity.
    publisher: { '@id': SCHEMA_IDS.organization(baseUrl) },
  };
}

/**
 * The graph the root layout puts on every page: the Organization and the WebSite, cross-linked by `@id`. The app's
 * SoftwareApplication isn't here: it ships whole, with its rating, on the homepage alone (getSoftwareApplicationSchema).
 */
export function getSiteGraph(baseUrl: string) {
  // Strip per-schema @context: the @graph wrapper provides it once.
  const { '@context': _org, ...org } = getOrganizationSchema(baseUrl);
  const { '@context': _site, ...website } = getWebSiteSchema(baseUrl);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...org, '@id': SCHEMA_IDS.organization(baseUrl) },
      { ...website, '@id': SCHEMA_IDS.website(baseUrl) },
    ],
  };
}

/**
 * The pages that are long reads, each with a TechArticle node (getLongReadSchema). Chosen by reading each page:
 * a piece of prose a person reads top to bottom, never a tool, a list or a calculator, whatever a crawler's guess
 * at page types says (Ahrefs listed tools and data pages as "missing Article schema", Nov 20 2026).
 * - /methodology: how every figure is made, sections of explanation with the arithmetic behind each figure.
 * Weighed and left out: /perm-case-statuses is a glossary, one definition a status with today's counts and a
 * lookup box, and already carries the type for that (DefinedTermSet); /editorial-standards, /about and the legal
 * pages are policies and facts about the site, which schema.org's WebPage kinds describe, not articles.
 * Guides and blog posts get their Article from src/lib/content/seo.ts.
 */
export const LONG_READS = ['/methodology'] as const;

export interface LongReadInput {
  path: (typeof LONG_READS)[number];
  headline: string;
  description: string;
  /** The day the page first went up (ISO). */
  datePublished: string;
  /** The day it last changed, the same day its WebPage node and its "Updated" line print. */
  dateModified: string;
  /** Its social card, absolute. */
  image?: string;
}

/**
 * A long read's TechArticle: an explanation of how something technical works. The author and publisher are the
 * site's Organization by reference (the root layout's node carries its name and logo on every page), and the page
 * it's the main entity of is the page's own WebPage node (SiteBreadcrumbs, `#webpage`), by reference too, so no
 * second full node repeats an `@id`.
 */
export function getLongReadSchema(baseUrl: string, input: LongReadInput) {
  const url = `${baseUrl}${input.path}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle' as const,
    headline: input.headline,
    description: input.description,
    url,
    mainEntityOfPage: { '@id': `${url}#webpage` },
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: { '@id': SCHEMA_IDS.organization(baseUrl) },
    publisher: { '@id': SCHEMA_IDS.organization(baseUrl) },
    inLanguage: 'en-US',
    ...(input.image ? { image: input.image } : {}),
  };
}

/** One question and its plain-text answer, as a page types it: `q` and `a`, or `question` and `answer`. */
export type FaqEntry = { q: string; a: string } | { question: string; answer: string };

/**
 * A page's FAQPage node, from the questions it shows. Every page builds it here (the structured-data gate fails a
 * FAQPage literal anywhere else), so each Question has its name and an acceptedAnswer with text, the shape the
 * engines that still read FAQPage ask for. The answer must be plain text: JSX would serialise to nothing.
 */
export function getFAQPageSchema(faqs: readonly FaqEntry[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage' as const,
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question' as const,
      name: 'q' in faq ? faq.q : faq.question,
      acceptedAnswer: {
        '@type': 'Answer' as const,
        text: 'q' in faq ? faq.a : faq.answer,
      },
    })),
  };
}

/**
 * The app's review rating when the site's own reviews can't be read.
 *
 * Since Oct 23 2026 the homepage and /reviews read the site's own approved
 * reviews (`getSiteReviews` in src/lib/reviews/read.ts, from convex/siteReviews.ts)
 * and pass that rating to both the visible line (ReviewsLine) and the JSON-LD
 * below, so the two always agree. This is the last rating recorded by hand,
 * used only when that read fails: the outside reviews of Oct 23 2026, 5 and 4
 * stars (insiders' reviews are never shown or counted).
 */
export const APP_RATING = {
  value: '4.5',
  count: '2',
  best: '5',
  worst: '1',
} as const;

/** A rating as schema.org's AggregateRating wants it: every field a string. */
export interface RatingFields {
  value: string;
  count: string;
  best: string;
  worst: string;
}

/**
 * Below this, the aggregate score is not ADVERTISED - no big 5.0 on the page,
 * no aggregateRating in the JSON-LD. The testimonials themselves and the
 * review CTA stay; it is the scorekeeping that goes quiet.
 *
 * Set to 2. The reviews are genuine and displayed. Google's ban on
 * self-serving review markup binds `LocalBusiness` and `Organization` types;
 * ours is `SoftwareApplication`, which is eligible, and the rating is visible
 * on the page (ReviewsLine renders it from this same constant), so the markup
 * and the visible text can't disagree.
 *
 * Google may still decline a rich result off two reviews, which costs
 * nothing. APP_RATING is only the fallback now: the live count comes from the
 * site's own reviews (`getSiteReviews`, src/lib/reviews/read.ts).
 */
export const MIN_REVIEWS_TO_ADVERTISE = 2;

export function shouldAdvertiseRating(count: string = APP_RATING.count): boolean {
  return Number(count) >= MIN_REVIEWS_TO_ADVERTISE;
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

/** The federal source every dataset on this site derives from. */
const DOL_SOURCE = 'https://www.dol.gov/agencies/eta/foreign-labor/performance';

export interface DatasetSchemaInput {
  /** Human name for this specific slice, e.g. "Microsoft Corporation PERM filings". */
  name: string;
  description: string;
  /** Absolute page URL this dataset is published at. */
  url: string;
  /**
   * ISO 8601 interval the underlying records span, e.g. "2023-10-01/2026-06-30".
   * MEASURED from the corpus, never written by hand - see the note below.
   */
  temporalCoverage?: string;
  /** ISO date the underlying data last changed (the source's as-of, not the build). */
  dateModified?: string;
  /** The columns this slice actually reports. */
  variableMeasured?: string[];
  keywords?: string[];
  /**
   * The federal page this slice derives from, when it is not the quarterly
   * disclosure files. `/perm-decision-activity` reads DOL's processing-times
   * publication instead, and pointing every dataset at one URL because the
   * builder happened to hardcode it would be a provenance claim we did not
   * check.
   */
  isBasedOn?: string;
  /**
   * A licence URL that replaces the default (our Terms). Only the open
   * datasets pass one: they are offered under CC BY-NC 4.0, and every other
   * Dataset on the site stays under the Terms' compilation clause.
   */
  license?: string;
  /** Files a reader can download, one per format. */
  distribution?: Array<{ encodingFormat: string; contentUrl: string }>;
}

/**
 * One Dataset node, built the same way everywhere.
 *
 * Ten pages hand-rolled this object with seven keys each, and every one of them
 * was missing the fields that make a dataset citable rather than merely
 * declared: `temporalCoverage`, `dateModified`, `license`, `variableMeasured`
 * and `spatialCoverage`. Those are what an answer engine needs to say WHEN a
 * figure was true and WHAT it covers, and they are exactly the difference
 * between a number a model will quote with a date and one it will quote bare.
 *
 * `temporalCoverage` and `dateModified` are PARAMETERS, deliberately. The
 * temptation is to bake in the current window, and a baked window is wrong the
 * day the next quarterly lands while still looking authoritative. Callers pass
 * what they measured; a caller with nothing to pass omits it rather than
 * guessing, because an absent field is honest and a stale one is not.
 *
 * `license` points at our terms rather than claiming public domain. The
 * underlying DOL records are a US Government work, but these pages publish
 * derived aggregates, and `isBasedOn` is where the provenance belongs.
 */
export function getDatasetSchema(baseUrl: string, input: DatasetSchemaInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset' as const,
    name: input.name,
    description: input.description,
    url: input.url,
    // @id-linked so the Dataset attaches to the same Organization entity the
    // WebSite and SoftwareApplication nodes publish under, instead of minting
    // a fourth anonymous "PERM Tracker" that no parser can reconcile.
    creator: { '@id': SCHEMA_IDS.organization(baseUrl) },
    isBasedOn: input.isBasedOn ?? DOL_SOURCE,
    // Anchored at the section, not the page. `/terms` alone pointed at a
    // document whose only mention of licensing was the licence the USER grants
    // US for their content; a researcher following it learned nothing about
    // whether they may reuse the data. §6 now separates the two layers: the
    // federal records are public domain and we claim nothing over them, the
    // compilation is ours.
    license: input.license ?? `${baseUrl}/terms#intellectual-property`,
    // Every record is a US filing. Constant, so it belongs here rather than in
    // ten call sites that could each spell it differently.
    spatialCoverage: { '@type': 'Place' as const, name: 'United States' },
    ...(input.temporalCoverage ? { temporalCoverage: input.temporalCoverage } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(input.variableMeasured ? { variableMeasured: input.variableMeasured } : {}),
    ...(input.keywords ? { keywords: input.keywords } : {}),
    ...(input.distribution
      ? {
          isAccessibleForFree: true,
          distribution: input.distribution.map((d) => ({ '@type': 'DataDownload' as const, ...d })),
        }
      : {}),
  };
}
