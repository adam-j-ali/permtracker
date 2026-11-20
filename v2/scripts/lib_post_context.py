"""What a chat post means with what's around it: the screenshot it carries, the person's own earlier message, and the
message it answers.

A post like "For EAD is NBC and for AP is TSC" or "Yes, approved today" gives nothing alone. Read with the person's own
"Got SU on EAD and AP" a minute before, or with the question it answers, it's a report. And a photo of a USCIS case page
is the report itself. So a post that gives nothing alone is read again with:

- its screenshot's text (read by tesseract on the owner's Mac and redacted there, never the picture), cut to the lines
  that carry a date or a step;
- the same person's earlier words: the message it replies to when they wrote it, and their previous message in the
  chat when it came within FOLLOW_ON of this one. These count as theirs;
- the message it answers when someone else wrote it. That's someone else's words: the regex parser never reads it,
  and the model gets it labelled as context only (lib_post_model.SYSTEM says how to treat it).

Pure functions over the readers' rows: {"id", "date" (UTC ISO), "sender" (salted hash), "reply_to", "text"}.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import lib_post_dates as post_dates
import lib_post_model as post_model

FOLLOW_ON = dt.timedelta(minutes=10)
SCREENSHOT_MAX = 900   # characters of a screenshot's text kept: the lines with a date or a step
OWN_MAX = 500          # characters of each earlier message of the person's
QUESTION_MAX = 300     # characters of the message answered
EARLIER = "[Earlier, the same person wrote:]"
ANSWERING = "[Replying to another member, whose words these are:]"
SCREENSHOT = "[Text in the screenshot they posted:]"
THIS_POST = "[This post:]"


def screenshot_lines(image_text: str | None, limit: int = SCREENSHOT_MAX) -> str:
    """The screenshot's lines that carry a date or a step, in order, up to `limit` characters."""
    if not image_text:
        return ""
    keep: list[str] = []
    size = 0
    for line in image_text.splitlines():
        line = line.strip()
        if not line or not (post_dates.DATE_RE.search(line) or post_model.STEP_WORD.search(line)):
            continue
        if size + len(line) > limit:
            break
        keep.append(line)
        size += len(line) + 1
    return "\n".join(keep)


def own_text(row: dict, images: dict | None = None, key: tuple | None = None) -> str:
    """A post's own words: its text, and its screenshot's useful lines when it has one."""
    text = row.get("text") or ""
    shot = screenshot_lines((images or {}).get(key)) if key is not None else ""
    return f"{text}\n{SCREENSHOT}\n{shot}".strip() if shot else text


class Thread:
    """One chat's posts, indexed for the context of each: by id, and each person's previous post."""

    def __init__(self, rows: list[dict]):
        self.by_id = {r["id"]: r for r in rows}
        self.previous: dict = {}
        last: dict[str, dict] = {}
        for r in sorted(rows, key=lambda x: x.get("date") or ""):
            who = r.get("sender")
            if not who:
                continue
            p = last.get(who)
            if p is not None and _gap(p, r) <= FOLLOW_ON:
                self.previous[r["id"]] = p
            last[who] = r

    def context(self, row: dict) -> tuple[list[dict], dict | None]:
        """The person's own earlier posts (oldest first) and the post answered, when someone else wrote it."""
        who = row.get("sender")
        own: list[dict] = []
        answered = None
        parent = self.by_id.get(row.get("reply_to"))
        if parent is not None:
            if who and parent.get("sender") == who:
                own.append(parent)
            else:
                answered = parent
                grand = self.by_id.get(parent.get("reply_to"))
                if who and grand is not None and grand.get("sender") == who:
                    own.append(grand)
        prev = self.previous.get(row["id"])
        if prev is not None and all(prev["id"] != o["id"] for o in own):
            own.insert(0, prev)
        own.sort(key=lambda x: x.get("date") or "")
        return own, answered


def _gap(a: dict, b: dict) -> dt.timedelta:
    try:
        return abs(dt.datetime.fromisoformat(b["date"]) - dt.datetime.fromisoformat(a["date"]))
    except (KeyError, TypeError, ValueError):
        return dt.timedelta.max


def carries_report(text: str) -> bool:
    """True when the post's own words name a step or write a date: the part of a report it can add."""
    return bool(post_model.STEP_WORD.search(text or "") or post_dates.DATE_RE.search(text or ""))


def added(with_post: dict | None, without: dict | None) -> dict | None:
    """The fields a post adds to what the person's earlier words give alone, or None when it adds nothing. The read
    with the post decides each field; the identity of the case (its category, office) comes along only with a date."""
    if not with_post:
        return None
    base = without or {}
    new = {k: v for k, v in with_post.items() if base.get(k) != v}
    dated = {k for k in new if k in ("category", "office", "center", "chargeability")}
    if not set(new) - dated:
        return None
    return new


def own_words(earlier: list[str], text: str) -> str:
    """What the regex parser reads: the person's own words only, earlier first."""
    return "\n".join([*(e[:OWN_MAX] for e in earlier if e), text]).strip()


def labelled(earlier: list[str], answered: str | None, text: str) -> str:
    """What the model reads: each part labelled, so another member's words are never taken as the poster's."""
    parts: list[str] = []
    for e in earlier:
        if e:
            parts += [EARLIER, e[:OWN_MAX]]
    if answered:
        parts += [ANSWERING, answered[:QUESTION_MAX]]
    parts += [THIS_POST, text]
    return "\n".join(parts)


def load_images(path: Path | None, place_field: str = "chat") -> tuple[dict[tuple, str], dict[str, list[dict]]]:
    """The screenshot reader's rows (a private JSONL): each photo's text by (chat, id), and, by chat, a post row for
    each photo that has no saved post (one sent with no caption)."""
    texts: dict[tuple, str] = {}
    rows: dict[str, list[dict]] = {}
    if path is None or not path.exists():
        return texts, rows
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
            place, pid = r[place_field], r["id"]
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        if r.get("image_text"):
            texts[(place, pid)] = r["image_text"]
        rows.setdefault(place, []).append(
            {"id": pid, "date": r.get("date"), "sender": r.get("sender"), "reply_to": r.get("reply_to"),
             "text": r.get("text") or ""})
    return texts, rows
