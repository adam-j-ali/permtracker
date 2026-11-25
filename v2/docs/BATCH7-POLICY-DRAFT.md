# Batch 7: Privacy Policy draft (not live)

This is a draft for the owner to read. Nothing here is on the site. The live Privacy Policy
(`src/app/(site)/(public)/privacy/page.tsx`) and the consent version (`POLICY_CONSENT_VERSION` in
`convex/lib/policyConsent.ts`, now `2026-11-18`) are unchanged on this branch.

## Why the policy needs a change

A case can now go past the I-140, and two of its new fields are personal data the policy doesn't
list today: the country of birth and the chargeability country. Its new dates and receipt numbers
fit the policy's "Important dates" line loosely, but they're better named. A bulletin alert switched
on from a case uses the account's own address for a list the policy already covers, and the draft
says so plainly.

Until the policy below is live, the green card section shouldn't ship to production.

## Proposed text: Case Data list (add these items)

- The green card's own steps, if you enter them: whether the case goes through adjustment of
  status in the US or a visa at a consulate, the preference category and its kind (such as EB-2 or
  EB-3 other worker), and the dates of the I-485, the work permit, the travel document, the
  National Visa Center, the DS-260, the interview and the card.
- USCIS receipt numbers you enter for the I-485, the work permit and the travel document. We use a
  receipt number only to show it on your case and to link it to the public status page you ask for.
- The country of birth and, when it differs, the country the case is charged to. We store each as a
  two-letter country code. We use them to name the visa bulletin line your case is in, and nowhere
  else. They're deleted with the case or your account.

## Proposed text: a bulletin alert from a case (new paragraph under the list subscriptions)

If you switch on "Email me when this line moves" on a case, we send the visa bulletin alert for
that case's line (its category and the bulletin column its country falls in) to your account's
address. It's the same alert anyone can sign up for on the bulletin pages, with the same link to
stop it in every email. We store your address and the line, never the country of birth itself.
Two cases on the same line share one alert. If your account's address hasn't been confirmed, we
email it once to ask first. The alert stops when you switch it off, use the link in an email, or
delete your account.

## Proposed text: Cases you choose to count in the public figures

No change yet. The owner's Nov 23 2026 decision adds the I-485, work permit and consulate dates to
the "Count my cases in the public figures" switch once its consent step ships. That step isn't
built on this branch, so the counted dates stay as the live policy lists them.

## When it ships

1. Put the text above into the policy page, with the page's own date.
2. Raise `POLICY_CONSENT_VERSION` to that date, so signed-in people see the change and confirm it.
3. Deploy Convex, then the site, the way CLAUDE.md says.
