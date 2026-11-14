/**
 * The employers page's words that state a fact about how the site works: the three steps and the questions.
 *
 * In a plain module so a test can hold each claim to the code it describes (forEmployers.test.ts): how often the
 * waiting cases are read, when the follow emails go, what the tick box is called, and the 180 days after a
 * certification. The answers are strings because they are also printed as FAQPage structured data.
 */

import { CASE_CHECKS } from "./sweepSchedule";

export const EMPLOYER_STEPS = [
  { title: "Find your company", body: "Search its name above." },
  { title: "Tick Every case too", body: "It's in the Follow box on your company's page. Add your email." },
  { title: "Confirm once", body: "One click in the confirmation email turns it on." },
] as const;

export const EMPLOYER_FAQS = [
  {
    q: "How can an employer check the status of its PERM cases?",
    a: "Search your company's name on this page. Its page lists its PERM cases as the Department of Labor holds them, counted by status, and each case number opens that case's own status page. DOL's case-status service is public, so no login is needed.",
  },
  {
    q: "Can HR track a PERM case without the attorney?",
    a: "Yes. A case's status at DOL is public record, read by its case number. The attorney files the case and receives DOL's notices, and this shows you the same status without asking for an update.",
  },
  {
    q: "Will I hear the day a case is certified?",
    a: `Yes, if you follow your company with Every case too ticked. PERM Tracker reads every waiting case's status from DOL ${CASE_CHECKS.length} times each weekday, and sends one email on a day any of your company's cases changed, in the morning or the early evening, Eastern time. To hear within minutes about particular cases, paste their numbers into the list box on the alerts page: one email confirms them all.`,
  },
  {
    q: "What happens after DOL certifies a PERM case?",
    a: "The employer files Form I-140 with USCIS, with the certification, and has 180 calendar days from the date DOL granted it. A certification that isn't filed in that time expires, and the PERM stage starts again.",
  },
  {
    q: "What does the email show?",
    a: "Each change in a sentence that says who acted, such as DOL certified 2 of its cases. Under it is each case by number, with the job title and filing month DOL holds for it. Each number links to that case's page.",
  },
  {
    q: "Does it show which employee a case is for?",
    a: "No. DOL publishes the employer, the job title, the dates and the status, never the worker's name, and PERM Tracker adds none. You match a case to a person by its case number, or by its job title and filing date.",
  },
  {
    q: "What does it cost?",
    a: "It's free, and following a company needs no account: an email address is all it asks for.",
  },
  {
    q: "How do I stop the emails?",
    a: "Every email has a one-click link that stops it, and a link to a page listing everything your address follows.",
  },
] as const;
