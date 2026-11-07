# USCIS Developer Portal registration: the answers, ready to paste

## Read on the portal Sat Nov 7 2026 (supersedes anything below that disagrees)

Read in a browser on developer.uscis.gov (Get Started, Sign Up, Sandbox, Production Access and its four
sub-pages, Demo, FAQs), Nov 7 2026, about 2 PM EST:

- **Sign-up is a USCIS Online Account** (myaccount.uscis.gov) **or Login.gov**: a personal identity account.
  The owner creates it in his own legal name; the persona can't hold it.
- **The primary contact "must be an authorized signatory who can legally bind your company/organization"**,
  signs the Developer Portal Affidavit with a wet signature, and must attend the demo. That is the owner (the
  operating agreement gives him full authority), so every "primary contact" below means the owner, not the
  persona. None of this is public.
- **Demo appointments are fully booked through January 2027; the next are in February 2027** (first come,
  first served; Wednesdays 1 to 2 PM and Thursdays 2 to 3 PM EST; Case Status demos are 30 minutes).
- **Before asking for production:** a developer account, a Developer Team App with the Case Status sandbox,
  at least 5 consecutive calendar days of sandbox traffic, with 200 and 4xx responses both seen. Then email
  developersupport@uscis.dhs.gov; USCIS answers with the affidavit (country of the development team, primary
  contact's name and email, organization name, phone, front-end application name, notification email, business
  home page) and later a 4-digit demo ID for a request header and a scheduler link.
- **The demo is graded pass or fail** on: clear input with helper text and validation; the request built
  correctly; OAuth 2.0 client credentials held on the server only ("Request originating from any client
  applications are prohibited"); success and error responses shown to the user; case status updates shown.
  The developer who leads it must answer questions about the code and architecture, and USCIS's FAQ asks teams
  to audit any AI-generated or agent-assisted code before it.
- **USCIS reviews** desktop and mobile readability, data retention and deletion, and privacy practices.
- **Sharing a login or API keys is prohibited** (FAQ): anyone else who needs the keys gets their own account
  and joins the Developer Team.
- **Before any sandbox key reaches the server:** the public `/uscis-case-status` page must not go live on
  sandbox keys (the sandbox knows only staging receipts, so every real receipt would read "not found"). Sandbox
  answers only the server's own exercise job and a demo, never the public page. Built Nov 7 2026: the page goes
  live on production keys only (`uscisPublic`), the route answers sandbox keys only for a caller carrying
  `x-pt-uscis-sandbox` with the site's REVALIDATE_SECRET (`uscisAnswers`), sandbox answers are never stored, and
  `permtracker-uscis@uscis-sandbox.timer` asks once a day (a staging receipt and an unknown one). The demo itself
  then needs the lookup shown against sandbox keys: a dev server with the sandbox keys in its own env, or the
  production site switched to sandbox for the half hour, decided nearer February.

Drafted Tue Sep 22 2026, 8:20 PM EDT, by the Track B fork. Adam submits this
himself. This file is in a public repository: it names no private email
address and no credential. The persona inbox is the one recorded in the
global notes under "Adam Ali (public persona)".

Portal: https://developer.uscis.gov (the Case Status API is under "APIs").
The portal is JavaScript-rendered; every fact below is from its own pages as
captured on Sep 21 2026 (the OpenAPI spec, version 1.0.1, and the Get Started
and Sandbox pages), not from memory.

## What the portal asks, and the answer

| Field | Answer |
|---|---|
| Organization name | Asolys LLC, doing business as PERM Tracker (renamed from PERM Tracker LLC Oct 8 2026) |
| Organization type | Software development organization, incorporated in the United States |
| State of incorporation | Florida |
| Website | https://permtracker.app |
| Privacy policy URL | https://permtracker.app/privacy#uscis-case-status |
| Terms of use URL | https://permtracker.app/terms |
| Section 508 conformance | See `section-508.md` in this folder; the attestation summary is below |
| Primary contact name | The owner, in his legal name (the affidavit requires an authorized signatory) |
| Primary contact email | the owner's own USCIS Online Account or Login.gov address; notifications to support@permtracker.app |
| Support / public contact | support@permtracker.app |
| Phone | Adam's choice; the LLC's registered agent (Northwest) does not answer for us |
| Application name | PERM Tracker USCIS Case Status Lookup |
| Environment requested | Sandbox first, then Production after the demo and affidavit |

## Purpose (paste as written, or trim)

PERM Tracker (permtracker.app) is a free public site that shows people
waiting on an employment-based green card where their case stands, using the
government's own records: the Department of Labor's PERM, prevailing wage and
LCA case statuses, the State Department's visa bulletin, and USCIS's published
I-140 and I-485 figures. The one record it cannot show today is the status of
a USCIS petition by receipt number.

We are requesting Case Status API access to add a receipt-number lookup page
(https://permtracker.app/uscis-case-status). A visitor types the receipt
number from their I-797 notice; we send that number to the API with our
credentials and show USCIS's own status text and dated history, with the time
we read it printed beside it. We store the receipt number, form type, status
text, dated history and lookup time so a repeat lookup of the same receipt is
answered from our copy inside a six-hour window instead of asking USCIS again,
and so a later lookup can show what changed. Stored lookups are deleted twelve
months after the last lookup. No name, email or other identifier is collected
with a lookup, nothing is published per receipt, and no notification is sent
from a lookup. The privacy policy section above states all of this.

The site's other case lookups (DOL) already run behind a global daily budget
charged before each call, a per-address limit, and a length-capped input; the
USCIS lookup is built on the same pattern, with the API's published limits
(10 transactions per second, 400,000 per day) enforced in our code below those
figures (a local token bucket at 10 TPS and a hard daily cap of 350,000).

## Expected volume

- Year one: well under 2,000 lookups a day. Our DOL live lookup, the closest
  comparable feature, runs under a 100,000-a-day budget and uses a small fraction of it.
- Peak: bursts follow visa-bulletin publication days; still far under the
  400,000 daily quota. We cap ourselves at 350,000 in code regardless.
- Concurrency: one call per visitor lookup; no batch or scheduled polling of
  receipts is planned for the first release. If a re-check sweep is ever added
  it will run on its own budget line below the daily cap.

## Section 508 attestation summary (the long form is section-508.md)

The lookup page is built to WCAG 2.1 AA practices: one H1 and a skip-free
heading outline, a labelled form control with visible focus, 44px targets,
native `<details>` disclosures readable with JavaScript off, status text
announced through `aria-live`, no colour-only meaning, 14px minimum text,
`prefers-reduced-motion` honoured, light and dark themes with AA contrast
tokens. Not yet done: a screen-reader pass and an automated axe run, listed as
open in section-508.md.

## The three open questions to ask on the form's free-text field (or by email)

1. **Public lookup under "your entity only".** The API terms say access is for
   use by the registered entity. Does that permit a public web page where any
   visitor enters a receipt number and our server, under our credentials,
   fetches and displays that case's status to them? If not, is there a
   permitted shape (for example, the visitor must attest the receipt is their
   own, or lookups must be account-gated)?
2. **`/processing-times/` with Case Status keys.** `https://api.uscis.gov/processing-times/`
   answers 401 to an unauthenticated request, so it exists, but it is not in
   the portal's API catalogue. Do Case Status API credentials authorize it, is
   it a separate product to apply for, or is it not offered to developers?
3. **Sandbox hours against the five-calendar-day window.** The sandbox is
   documented as open weekdays 7 AM to 8 PM Eastern, and the demo guidance
   references a window of five calendar days. Does that window count only
   sandbox hours, and does it start at credential issue or at first call?

## Notes for Adam before submitting

- Identity forms are shown to Adam before submission (standing rule). This
  file IS that preview; nothing has been submitted.
- Registering as the LLC is Adam's decision of Sep 22 2026; the About page
  names Sabrina Soltau as the site's public face. Superseded Nov 7 2026: the
  account and the affidavit carry the owner's legal name (see the top section),
  never the persona.
- The affidavit and the demo come AFTER sandbox access: see
  `affidavit-and-demo.md`.
