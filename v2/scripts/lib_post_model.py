"""Read the posts the parser can't, with a small model, and keep only the dates the post itself writes.

scripts/lib_post_dates.py reads the template posts ("Filing: 09/23/2022 ... Approval date: 8/18/23") and refuses
anything it would have to guess. Free-form posts ("my 140 got approved on the 12th, two weeks after biometrics") go
to a model here, in batches, through the Claude Code command line on the owner's plan (`claude -p`, the floating
"haiku" alias, low effort, no tools, no settings, no connectors).

The model is trusted for one thing only: which step a date belongs to. Everything else is checked here:

- two days for one step (often a spouse's and the poster's own) leave that step out, and the rest stands;
- every date it returns must be one the post writes (lib_post_dates.written_dates: a day that reads both ways gives
  both readings, a day without a year gives the nearby years, "today" gives the post's day). One date the post
  doesn't write and the whole answer for that post is dropped, since a made-up date means it misread the post;
- the answer must pass the parser's own checks (lib_post_dates.sound): a date and a second date or a decision, no
  date after the post, the steps in order;
- a post the model says isn't the poster's own case (a question, a friend's or a child's case, a forecast) gives
  nothing.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

import lib_post_dates as post_dates
import lib_reported_cases as rc

MODEL = "haiku"
EFFORT = "low"
BATCH = 40
WORKERS = 3     # batches asked at once: each is a `claude` process of about 250 MB on an 8 GB Mac
MAX_TEXT = 1200
# A post worth asking about: it writes a date and names a step. Everything else gives nothing and isn't asked.
STEP_WORD = re.compile(r"\b(approv\w*|certif\w*|filed|filing|receipt|rd|pd|priority|biometric\w*|bio|ead|"
                       r"transfer\w*|interview|denied|audit|rfe|green\s*card|gc)\b", re.I)

# Each step the model may name, and the merge's fields it fills: (date field, decision field, decision).
STEPS: dict[str, tuple[str | None, str | None, str | None]] = {
    "pwd_filed": ("pwd_filed", None, None),
    "pwd_issued": ("pwd_issued", None, None),
    "perm_filed": ("perm_filed", None, None),
    "perm_audit": ("perm_audit", None, None),
    "perm_approved": ("perm_decided", "perm_decision", "approved"),
    "perm_denied": ("perm_decided", "perm_decision", "denied"),
    "priority_date": ("priority_date", None, None),
    "i140_filed": ("i140_receipt", None, None),
    "i140_approved": ("i140_decided", "i140_decision", "approved"),
    "i140_denied": ("i140_decided", "i140_decision", "denied"),
    "i485_filed": ("i485_receipt", None, None),
    "biometrics": ("biometrics", None, None),
    "ead_approved": ("ead", None, None),
    "ap_approved": ("ap", None, None),
    "transferred": ("transfer", None, None),
    "interview": ("interview", None, None),
    "i485_approved": ("i485_decided", "i485_decision", "approved"),
    "i485_denied": ("i485_decided", "i485_decision", "denied"),
    "card_produced": ("card", None, None),
}
CATEGORIES = ("EB-1", "EB-2", "EB-2 NIW", "EB-3")

SYSTEM = """You read posts from US green card chat groups and return the dates each post gives about the poster's own case.

For each post, first decide own_case: true only when the post reports the poster's own case (or their household's
case written as their own). False for a question about other people, a friend's, colleague's, child's or parent's
case, a hypothetical, a forecast, a plan, or general talk. When own_case is false, return no steps.

For an own case, list each step the post gives a date for, with the date as YYYY-MM-DD, or YYYY-MM when the post gives
only a month. Copy the date the post writes; never work one out from a duration ("two weeks later"). A missing year may
be filled with the post's year only for a step that happened in the last four months. "today" is the post's date.
A receipt date is the date printed on the notice (RD), never the day a letter arrived in the mail.
A step whose outcome is stated with no date (e.g. "Status: Approved") may be listed with date null.
When you can't tell which step or which form a date belongs to, leave it out. Leaving a date out is always better
than a wrong one.

Steps: pwd_filed and pwd_issued (prevailing wage request and its determination); perm_filed (PERM filing; in a chat of
kind "perm", "PD" or "filed" with no form named means this); perm_audit; perm_approved (certified) or perm_denied;
priority_date (only when written as PD or priority date in a chat that isn't of kind "perm"); i140_filed (I-140 filed
or received by USCIS); i140_approved or i140_denied; i485_filed (I-485 filed, or its receipt date, "RD"); biometrics;
ead_approved (work permit, I-765); ap_approved (advance parole, I-131); transferred (case moved to a field office or
centre); interview (the I-485 interview day); i485_approved (green card approved) or i485_denied; card_produced (the
green card itself produced or mailed, never a work permit card).

category: EB-1, EB-2, EB-2 NIW or EB-3 when the post says which; otherwise null."""

SCHEMA = {
    "type": "object",
    "properties": {"posts": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "own_case": {"type": "boolean"},
            "steps": {"type": "array", "items": {
                "type": "object",
                "properties": {"step": {"type": "string", "enum": list(STEPS)},
                               "date": {"type": ["string", "null"]}},
                "required": ["step", "date"], "additionalProperties": False}},
            "category": {"type": ["string", "null"], "enum": [*CATEGORIES, None]},
        },
        "required": ["id", "own_case", "steps", "category"], "additionalProperties": False}}},
    "required": ["posts"], "additionalProperties": False,
}


def claude_runner(prompt: str) -> dict:
    """One call to the model through the Claude Code command line: no tools, settings or connectors, nothing saved."""
    proc = subprocess.run(
        ["claude", "-p", "--model", MODEL, "--effort", EFFORT, "--no-session-persistence", "--setting-sources", "",
         "--strict-mcp-config", "--tools", "", "--system-prompt", SYSTEM, "--output-format", "json",
         "--json-schema", json.dumps(SCHEMA)],
        input=prompt, capture_output=True, text=True, timeout=600)
    try:
        doc = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"the model's reply wasn't JSON (exit {proc.returncode}): {proc.stderr[:300]}") from e
    if doc.get("is_error") or not isinstance(doc.get("structured_output"), dict):
        raise RuntimeError(f"the model call failed: {str(doc.get('result'))[:300]}")
    return doc["structured_output"]


def prompt_for(posts: list[dict]) -> str:
    """The batch as the model reads it: each post's id, the day it was posted, its chat's kind, and its text."""
    return json.dumps([{"id": p["id"], "posted": p["posted"], "chat_kind": p["kind"], "text": p["text"][:MAX_TEXT]}
                       for p in posts], ensure_ascii=False)


def from_answer(answer: dict, post: dict) -> dict | None:
    """One post's answer as the merge's fields, or None when it isn't the poster's own case or fails a check."""
    if not answer.get("own_case"):
        return None
    posted = dt.date.fromisoformat(post["posted"])
    written = post_dates.written_dates(post["text"], posted)
    out: dict[str, str] = {}
    torn: set[str] = set()
    for item in answer.get("steps") or []:
        spec = STEPS.get(item.get("step"))
        if spec is None:
            return None
        field, decision_field, decision = spec
        date = item.get("date")
        if date is not None:
            if not (rc.DAY_RE.match(date) or rc.MONTH_RE.match(date)) or date not in written:
                return None  # a date the post doesn't write: it misread the post
            if out.get(field, date) != date:
                torn.add(field)  # two days for one step (a spouse's and the poster's): that step says nothing
            out[field] = date
        if decision_field:
            if out.get(decision_field, decision) != decision:
                return None  # approved and denied at once
            out[decision_field] = decision
    for field in torn:
        out.pop(field, None)
    if not post_dates.sound(out, posted, own=True):
        return None
    if answer.get("category") in CATEGORIES:
        out["category"] = answer["category"]
    return out


def worth_asking(text: str) -> bool:
    return len(text or "") < 2000 and bool(post_dates.DATE_RE.search(text or "")) and bool(STEP_WORD.search(text or ""))


def read_posts(posts: list[dict], runner: Callable[[str], dict] = claude_runner, workers: int = 1,
               on_batch: Callable[[dict[str, dict | None]], None] | None = None) -> dict[str, dict | None]:
    """Every answered post's fields by id (None where it gives nothing), the model asked BATCH posts at a time.

    A post the reply leaves out is left out here too, so it's asked again next time rather than taken as empty.
    on_batch gets each batch's answers as they come, so a long run that stops keeps what it read."""
    batches = [posts[i:i + BATCH] for i in range(0, len(posts), BATCH)]

    errors: list[str] = []

    def one(batch: list[dict]) -> dict[str, dict | None]:
        try:
            reply = runner(prompt_for(batch))
        except Exception as e:  # noqa: BLE001 - one failed batch is asked again next run; the run still ends red
            errors.append(f"{type(e).__name__}: {str(e)[:200]}")
            return {}
        answers = {a.get("id"): a for a in reply.get("posts") or [] if isinstance(a, dict)}
        return {p["id"]: from_answer(answers[p["id"]], p) for p in batch if p["id"] in answers}

    out: dict[str, dict | None] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for got in pool.map(one, batches):
            out.update(got)
            if on_batch and got:
                on_batch(got)
    if errors:
        raise ModelBatchesFailed(f"{len(errors)} of {len(batches)} batches failed (they're asked again next run); "
                                 f"first: {errors[0]}", out)
    return out


class ModelBatchesFailed(RuntimeError):
    """Some batches failed; .read holds what the others read, already handed to on_batch."""

    def __init__(self, message: str, read: dict):
        super().__init__(message)
        self.read = read
