"""The text in a screenshot someone posted of their own case (a USCIS case page, an account update, a notice), read on
the owner's Mac and redacted there before it's kept.

Shared by the Telegram and Reddit readers (outside this repository, on the owner's Mac). The picture is read from
memory by tesseract and never written to disk; the text kept loses the numbers that identify a person's case or reach
them (REDACT). Only the dates and steps scripts/ingest_community_posts.py reads from it ever leave the Mac.
"""
from __future__ import annotations

import re
import subprocess

# What a screenshot's text loses before it's kept: a receipt or A-number, an email or a phone number has no use here.
REDACT = [
    (re.compile(r"\b[A-Z]{3}\s?\d{10}\b"), "[receipt]"),
    (re.compile(r"\bA[- ]?\d{3}[- ]?\d{3}[- ]?\d{3}\b"), "[A-number]"),
    (re.compile(r"\b[GPI]-\d{3}-\d{5}-\d{6}\b"), "[DOL case number]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"(?:\+1[ .-]?)?\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b"), "[phone]"),
]
MAX_BYTES = 12_000_000  # a picture larger than this isn't read: no screenshot is that big


def redact(text: str) -> str:
    for pattern, mark in REDACT:
        text = pattern.sub(mark, text)
    return text


def read_picture(image: bytes, timeout: int = 90) -> str:
    """A picture's text by tesseract, from memory, redacted; empty when it can't be read."""
    if not image or len(image) > MAX_BYTES:
        return ""
    try:
        out = subprocess.run(["tesseract", "stdin", "stdout", "-l", "eng"], input=image, capture_output=True,
                             timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if out.returncode != 0:
        return ""
    lines = [ln.strip() for ln in out.stdout.decode("utf-8", "replace").splitlines()]
    return redact("\n".join(ln for ln in lines if ln))
