"""The post reader (scripts/lib_post_dates.py): which dates a person's own post gives, and which it never guesses.

Every post here is made up, shaped like the ones people write in the PERM and green card chats.
Run: python3 scripts/test_lib_post_dates.py
"""
from __future__ import annotations

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib_post_dates as pd  # noqa: E402

POSTED = dt.date(2023, 10, 24)


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    def read(text: str, kind: str = "perm", posted: dt.date = POSTED, order: str = "mdy") -> dict | None:
        return pd.read_post(text, posted, kind, order)

    # The template people post when PERM is certified.
    r = read("PERM certified! Filing date: 11/29/2022 Approval date: 10/24/2023 Employer Initial: K State: FL")
    check(r == {"perm_filed": "2022-11-29", "perm_decided": "2023-10-24", "perm_decision": "approved"}, f"the template: {r}")
    r = read("My Perm approved Filing: 09/23/2022 State: TX Status: Approved Approval date: 8/18/23", posted=dt.date(2023, 8, 21))
    check(r == {"perm_filed": "2022-09-23", "perm_decided": "2023-08-18", "perm_decision": "approved"},
          f"a two-digit year, and the nearest label wins: {r}")
    r = read("Case number: A-22355-xxxxx PD: 12/21/2022 Status: Certified Approval Date: 12/5/2023", posted=dt.date(2023, 12, 5))
    check(r == {"perm_filed": "2022-12-21", "perm_decided": "2023-12-05", "perm_decision": "approved"},
          f"a case number isn't a date, and PD in a PERM chat is the filing day: {r}")
    r = read("PERM NOT Certified PD: 12/13/2022 Denial- 11/22/2023 Region: 1", posted=dt.date(2023, 11, 28))
    check(r == {"perm_filed": "2022-12-13", "perm_decided": "2023-11-22", "perm_decision": "denied"}, f"a denial: {r}")
    r = read("PERM Certified! Filing: 09/29/2022 Status: Approved Approval date : 07/18", posted=dt.date(2023, 7, 18))
    check(r == {"perm_filed": "2022-09-29", "perm_decided": "2023-07-18", "perm_decision": "approved"},
          f"an approval day without a year takes the post's year: {r}")
    r = read("my perm is certified today. I only know pd is 01/06/2023.", posted=dt.date(2024, 1, 12))
    check(r == {"perm_filed": "2023-01-06", "perm_decided": "2024-01-12", "perm_decision": "approved"}, f"'today' is the post's day: {r}")
    r = read("PERM Certified (I'm in tracker) Filing: 09/06/2022 State: IL Approval date : Don't know.")
    check(r == {"perm_filed": "2022-09-06", "perm_decision": "approved"}, f"certified with no day given: {r}")

    # What it never guesses.
    check(read("My PD is Dec 09. When it will be processed?") is None, "a question with a day and no year")
    check(read("My perm file date is 09/09/22, still waiting for approval.") is None, "one date and nothing decided")
    check(read("Is there anyone who filed on or before 09/09 waiting for results?") is None, "someone else's date in a question")
    check(read("Just heard from friend, 9/16 approved today.") is None, "a friend's case")
    check(read("10/27- Approved Region 5") is None, "a filing day without a year")
    check(read("Filing: 09/23/2022 Approval date: 08/18/2021") is None, "decided before it was filed: misread, so dropped")
    check(read("Filing: 05/06/2022 Approval: 10/04/2023", order="unknown") is None,
          "a day that reads both ways in a chat with no settled order")
    r = read("Filing: 25/06/2022 Approval: 24/10/2023", order="mdy")
    check(r == {"perm_filed": "2022-06-25", "perm_decided": "2023-10-24", "perm_decision": "approved"},
          f"a day over 12 settles the order for the whole post: {r}")
    r = read("Filing: 05/06/2022 Approval: 10/04/2023", order="dmy", posted=dt.date(2023, 4, 12))
    check(r == {"perm_filed": "2022-06-05", "perm_decided": "2023-04-10", "perm_decision": "approved"}, f"the chat's own order: {r}")
    check(read("Roundup: 09/21 approved 8/4, 09/22 approved 8/5, 09/23 approved 8/6, 09/24 approved 8/7") is None,
          "a roundup of other people's cases")
    check(read("Filing: 09/23/2022 Approval date: 12/18/2023") is None, "an approval after the post was written")
    check(read("Who all are waiting for approval ( FD Sep 3rd week - Sep 15-19)") is None, "people waiting, a week named")
    check(read("any Sep approvals after Sep 20th?") is None, "a question about other people's approvals")
    check(read("There is no Feb 2023 approval in DOL's data, which has the approvals in July 2023") is None,
          "talk about DOL's data")
    check(read("Assuming my PD is May 2023 and PERM is approved, when can I file the I-140?") is None, "a supposition")
    check(read("It's a DOL holiday today so wondering whether it was approved today") is None, "wondering")
    check(read("Today no approval with Oct 13th yet. Is it normal?") is None, "no approval yet")
    r = read("My i140 approved in July 2023. My h1 extension filed in premium and if h1 is denied what next", kind="perm")
    check(r == {"i140_decided": "2023-07", "i140_decision": "approved", "premium": "yes"},
          f"an H-1B denial isn't PERM's: {r}")
    r = read("PERM certified! Filing: 09/29/2022 Approval date: 01/05")
    check(r == {"perm_filed": "2022-09-29", "perm_decision": "approved"},
          f"an approval day without a year from long before the post isn't placed in any year: {r}")

    r = read("my I 140 filed on Aug 7th 2023, it's approved on Feb 22nd 2024.", posted=dt.date(2024, 3, 3))
    check(r == {"i140_receipt": "2023-08-07", "i140_decided": "2024-02-22", "i140_decision": "approved"},
          f"'I 140' with a space is the I-140, and the approval after it is the I-140's too: {r}")
    r = read("My 140 PP filed on 12/4, approved on 12/12", posted=dt.date(2023, 12, 15))
    check(r == {"i140_decided": "2023-12-12", "i140_decision": "approved", "premium": "yes"},
          f"a bare '140' is the I-140, and its filing day needs a year: {r}")
    check(read("So if you get approved today and the filing date is FEB 23 you wait") is None, "'if you get approved today'")
    check(read("My PD 10/10/22, trying to see if my PERM approved by Aug 4") is None, "hoping for an approval")
    check(read("My pd is aug 22. I got denied aug 23, due to the Sunday ad") is None, "'aug 23' may be a year")
    r = read("Filled : 05/13/2023 Status :Approved Approval Date : 06/04/2024", posted=dt.date(2024, 6, 5))
    check(r == {"perm_filed": "2023-05-13", "perm_decided": "2024-06-04", "perm_decision": "approved"}, f"'Filled': {r}")
    r = read("Perm approved: FD - 5/11/23 Approved date - 6/10/24", posted=dt.date(2024, 6, 10))
    check(r == {"perm_filed": "2023-05-11", "perm_decided": "2024-06-10", "perm_decision": "approved"}, f"'FD': {r}")
    r = read("Date of application: 06/29/2023 Date of Approval: 08/17/2024", posted=dt.date(2024, 8, 17))
    check(r == {"perm_filed": "2023-06-29", "perm_decided": "2024-08-17", "perm_decision": "approved"},
          f"'Date of application': {r}")
    r = read("Filing 12/20/2022 Status : Approved Approval Notice: 11/29/2023", posted=dt.date(2023, 11, 29))
    check(r == {"perm_filed": "2022-12-20", "perm_decided": "2023-11-29", "perm_decision": "approved"},
          f"'Approval Notice': {r}")

    check(read("Perm certified: 7/14/23 Thank you all", posted=dt.date(2024, 8, 30)) is None,
          "a lone 'certified' day a year before the post is likely the filing day")
    check(read("At this pace my mid September perm will be approved in April 2025!", posted=dt.date(2024, 8, 15)) is None,
          "a guess about the future")
    r = read("Filing: 10/13/2022 Status: Approved Approval Date: 28-Aug-2023", posted=dt.date(2023, 8, 28))
    check(r == {"perm_filed": "2022-10-13", "perm_decided": "2023-08-28", "perm_decision": "approved"}, f"28-Aug-2023: {r}")
    r = read("Perm certified Submission date: 08-22-2023 Decision date: 12-01-2024", posted=dt.date(2024, 12, 4))
    check(r == {"perm_filed": "2023-08-22", "perm_decided": "2024-12-01", "perm_decision": "approved"},
          f"'Submission date': {r}")
    r = read("PERM Approved PD: 02/17/2023 Status: Approved Approval\uff1a03/21/24", posted=dt.date(2024, 3, 21))
    check(r == {"perm_filed": "2023-02-17", "perm_decided": "2024-03-21", "perm_decision": "approved"},
          f"a full-width colon: {r}")

    r = read("Perm certified Applied - 7th August 2023 Received - 13th November 2024", posted=dt.date(2024, 11, 13))
    check(r == {"perm_filed": "2023-08-07", "perm_decision": "approved"},
          f"'Received' in a PERM post is when the news came, never the filing day: {r}")
    r = read("Not sure but my employer filed my 140 and my PERM was certified on 09/25", posted=dt.date(2023, 10, 16))
    check(r == {"perm_decided": "2023-09-25", "perm_decision": "approved"}, f"the form named nearest wins: {r}")
    r = read("Perm certified PD-12/14/2022 Approval date- 11/17/2023", posted=dt.date(2023, 11, 17))
    check(r == {"perm_filed": "2022-12-14", "perm_decided": "2023-11-17", "perm_decision": "approved"},
          f"a hyphen against the date: {r}")
    r = read("Perm approved 01/26/2024. I140 premium submitted 02/16/2024. I140 approval received-02/22/2024",
             posted=dt.date(2024, 2, 22))
    check(r == {"perm_decided": "2024-01-26", "perm_decision": "approved", "i140_receipt": "2024-02-16",
                "i140_decided": "2024-02-22", "i140_decision": "approved", "premium": "yes"}, f"'approval received-': {r}")
    check(pd.parse_date("A-22355-12345", POSTED, "mdy") is None, "a case number")
    r = read("Case number: A-22355-xxxxx PD: 12/21/2022 Approval Date: 12/5/2023", posted=dt.date(2023, 12, 5))
    check(r == {"perm_filed": "2022-12-21", "perm_decided": "2023-12-05", "perm_decision": "approved"},
          f"still no date inside a case number: {r}")

    # The later steps.
    r = read("I-140 filed 02/03/2024 with PP, I140 approved 02/20/2024", kind="mixed", posted=dt.date(2024, 2, 21))
    check(r == {"i140_receipt": "2024-02-03", "i140_decided": "2024-02-20", "i140_decision": "approved", "premium": "yes"},
          f"the I-140: {r}")
    r = read("PD: 03/2023 EB2 I485 RD: 08/14/2025 Bio: 09/10/2025 EAD/AP approved: 01/05/2026 Transferred to SFV: 09/24/2026 "
             "GC approved 11/03/2026", kind="i485", posted=dt.date(2026, 11, 4))
    check(r == {"priority_date": "2023-03", "category": "EB-2", "i485_receipt": "2025-08-14", "biometrics": "2025-09-10",
                "ead": "2026-01-05", "ap": "2026-01-05", "transfer": "2026-09-24", "i485_decided": "2026-11-03",
                "i485_decision": "approved"}, f"an I-485 timeline: {r}")
    r = read("Interview scheduled: Dec 15, 2026. RD Aug 2025, NIW", kind="i485", posted=dt.date(2026, 11, 4))
    check(r == {"interview": "2026-12-15", "i485_receipt": "2025-08", "category": "EB-2 NIW"},
          f"an interview ahead of the post, a month alone: {r}")
    r = read("Received 2/3/2024, approved 6/1/2024", kind="mixed", posted=dt.date(2024, 6, 2))
    check(r is None, f"no form named in a chat about several forms: {r}")
    r = read("EB3 to EB2 interfile done. I485 RD 08/14/2025, approved 11/03/2026", kind="i485", posted=dt.date(2026, 11, 4))
    check(r is not None and "category" not in r, f"two categories in one post leave it blank: {r}")

    # Timelines written date first, each date taking the step after it.
    r = read("I-140 Approved!! PD: October 30, 2022 Oct 2022 - Perm filed Oct 2023 - Perm approved Feb 5 2024 - uscis "
             "received i140 Feb 13, 2024 - I-140 approved (Premium processing)", kind="mixed", posted=dt.date(2024, 2, 23))
    check(r == {"priority_date": "2022-10-30", "perm_filed": "2022-10", "perm_decided": "2023-10",
                "perm_decision": "approved", "i140_receipt": "2024-02-05", "i140_decided": "2024-02-13",
                "i140_decision": "approved", "premium": "yes"}, f"a date-first timeline: {r}")
    r = read("Sharing my timeline Nov 2: filed 140/485 concurrently with pp Nov 3: received by USCIS Nov 8: 140 approved "
             "Nov 10: 485 receipt arrives in mail", kind="mixed", posted=dt.date(2023, 11, 15))
    check(r == {"i140_decided": "2023-11-08", "i140_decision": "approved", "premium": "yes"},
          f"date first with colons; a day without a year for a filing is dropped: {r}")
    r = read("Filing: 09/23/2022 - Approval date: 8/18/23 - State: TX", posted=dt.date(2023, 8, 21))
    check(r == {"perm_filed": "2022-09-23", "perm_decided": "2023-08-18", "perm_decision": "approved"},
          f"a template with dashes between its fields stays label first: {r}")
    check(read("Sharing an update: my i-140 was sent to USCIS concurrently with i-485 on November 9, PP, the case was "
               "approved in November 16.", kind="mixed", posted=dt.date(2023, 11, 17)) is None,
          "'the case was approved' after both forms says nothing about which")
    check(read("Finally! My dependent's EAD changed to new card is being produced today. Biometrics date - Jan 17th",
               kind="mixed", posted=dt.date(2024, 3, 7)) is None, "a dependent's case")
    r = read("I485 RD: 08/14/2025 Green card produced: 11/05/2026", kind="i485", posted=dt.date(2026, 11, 6))
    check(r == {"i485_receipt": "2025-08-14", "card": "2026-11-05"}, f"the green card's production: {r}")
    r = read("EAD card produced 11/05/2026, biometrics 09/10/2026", kind="i485", posted=dt.date(2026, 11, 6))
    check(r is None or "card" not in r, f"an EAD card isn't the green card: {r}")

    check(read("Still waiting for AP. For my daughter EAD approved on 9/3 and her AP approved on 9/4", kind="mixed",
               posted=dt.date(2024, 9, 20)) is None, "a child's case")
    r = read("I became current this month, my GC EAD approved today, my I 485 is still pending", kind="mixed",
             posted=dt.date(2024, 3, 29))
    check(r is None or "i485_decided" not in r, f"'GC EAD approved today' is the work permit, never the green card: {r}")
    r = read("RD - Feb 28, 2024 Biometrics - Apr 2, 2024 EAD+AP approved - June 14, 2024", kind="i485",
             posted=dt.date(2024, 7, 1))
    check(r == {"i485_receipt": "2024-02-28", "biometrics": "2024-04-02", "ead": "2024-06-14", "ap": "2024-06-14"},
          f"'EAD+AP': {r}")
    r = read("PWD submission 09-15-2021 PWD determination 03-15-2022 PERM submission 11-02-2022 PERM approved 11-01-2023",
             kind="mixed", posted=dt.date(2024, 11, 15))
    check(r == {"pwd_filed": "2021-09-15", "pwd_issued": "2022-03-15", "perm_filed": "2022-11-02",
                "perm_decided": "2023-11-01", "perm_decision": "approved"}, f"'submission': {r}")
    r = read("Hi all I140 Approved Priority Date: 01/12/2023 Receipt Date: 03/08/2024 Approval Date: 03/14/2024 Premium "
             "processing. I didn't file the i-485 concurrently", kind="mixed", posted=dt.date(2024, 3, 14))
    check(r == {"priority_date": "2023-01-12", "i140_receipt": "2024-03-08", "i140_decided": "2024-03-14",
                "i140_decision": "approved", "premium": "yes"}, f"the form a post opens with: {r}")

    r = read("My GC EAD (EB2) got approved yesterday Filed Nov-19-2024 Bio-Dec 16 Approved - Jan 15 PD is current Waiting "
             "for 131/485 Approvals", kind="mixed", posted=dt.date(2025, 1, 16))
    check(r is None or "i485_decided" not in r, f"a bare approval in a post naming the work permit isn't the I-485's: {r}")

    # Dates themselves.
    check(pd.parse_date("Mar 3, 2024", POSTED, "mdy") == ("2024-03-03", True), "a month name")
    check(pd.parse_date("3rd March 2024", POSTED, "mdy") == ("2024-03-03", True), "a day before the month name")
    check(pd.parse_date("2024-03-03", POSTED, "unknown") == ("2024-03-03", True), "ISO reads in any chat")
    check(pd.parse_date("13/14/2024", POSTED, "mdy") is None, "no 13th month either way")
    check(pd.parse_date("02/30/2024", POSTED, "mdy") is None, "no February 30th")
    check(pd.chat_order(["03/25/2023"] * 19 + ["25/03/2023"]) == "mdy", "a chat that writes month first")
    check(pd.chat_order(["03/25/2023"] * 5 + ["25/03/2023"] * 5) == "unknown", "a chat split both ways")
    check(pd.chat_order(["03/04/2023"] * 50) == "unknown", "a chat with no day over 12 says nothing")

    # The work permit and travel document by their form numbers (a Telegram timeline, Nov 21 2026): "I-765: Approval
    # document appeared on 11/17" is the work permit's approval and "I-131: Approval Notice on 11/21" the travel
    # document's. A bare RD in a chat about several forms still names no form, and a year typed as 27 stays unread.
    nov21 = dt.date(2026, 11, 21)
    r = read("Timeline: PD 03/13/2024 RD 12/18/2025 Bio: 01/16/2026 silence, and some silent updates still "
             "I485J Approval: 10/26/27 I485: Interview Scheduled to 12/2/27 I-765: Approval document appeared on 11/17, "
             "card was produced appeared on 11/19 I-131: Approval Notice on 11/21 so seem to be two standalone "
             "approvals not one common, but not quite sure", kind="mixed", posted=nov21)
    check(r == {"priority_date": "2024-03-13", "biometrics": "2026-01-16", "ead": "2026-11-17", "ap": "2026-11-21"},
          f"the I-765 and I-131 by number: {r}")
    r = read("My I-765 approved on 11/17 and I-131 approved 11/19", kind="mixed", posted=nov21)
    check(r == {"ead": "2026-11-17", "ap": "2026-11-19"}, f"the form numbers with a plain approved: {r}")
    r = read("My I-765 received 10/01/2026, still waiting", kind="mixed", posted=nov21)
    check(r is None or "ead" not in r, f"an I-765 receipt is never its approval: {r}")
    r = read("My I-485 approved on 11/17/2026!", kind="mixed", posted=nov21)
    check(r == {"i485_decided": "2026-11-17", "i485_decision": "approved"}, f"the I-485 still reads as before: {r}")

    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
