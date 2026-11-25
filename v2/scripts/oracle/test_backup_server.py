#!/usr/bin/env python3
"""The sealed server copy carries every path a rebuild needs, the private extra list's too.

bin/permtracker-backup-server seals the server's own secrets, config, installed scripts and units each night. Paths
this public repository doesn't name are listed in /etc/permtracker/backup-extra.list (which the copy includes): each
is read, must exist like the named ones, and goes into the same archive (Nov 24 2026: a hand-added server piece had
no copy anywhere). Checked by running the script's list-reading lines in bash against a scratch list.

Run: python3 scripts/oracle/test_backup_server.py
"""
from __future__ import annotations

import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = (HERE / "bin" / "permtracker-backup-server").read_text()
failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)


for must in ("/srv/permtracker/app/env", "/etc/permtracker", "/etc/systemd/system", "/usr/local/bin", "/usr/local/sbin",
             "/etc/cloudflared", "/etc/nginx/conf.d"):
    check(must in SCRIPT.split("REQUIRED=(")[1].split(")")[0], f"the copy names {must}")
check('"${REQUIRED[@]}" "${EXTRA[@]}"' in SCRIPT.split("tar --zstd -cf -")[1].split("\n")[0], "the archive holds the extra paths too")
check('for p in "${REQUIRED[@]}" "${EXTRA[@]}"; do [ -e "$p" ]' in SCRIPT, "an extra path that's missing stops the copy")

# The list-reading lines, run for real against a scratch list: comments, blanks and trailing spaces are dropped.
block = SCRIPT[SCRIPT.index("EXTRA=()"):SCRIPT.index('for p in "${REQUIRED[@]}"')]
with tempfile.TemporaryDirectory() as tmp:
    lst = pathlib.Path(tmp) / "backup-extra.list"
    lst.write_text("# private paths\n/etc/one\n\n  \n/home/u/.config/two   # a note\n/last/no-newline")
    out = subprocess.run(["bash", "-c", block.replace("/etc/permtracker/backup-extra.list", str(lst)) + 'printf "%s|" "${EXTRA[@]}"'],
                         capture_output=True, text=True, check=True).stdout
    check(out == "/etc/one|/home/u/.config/two|/last/no-newline|", f"the list reads its paths and nothing else: {out!r}")
    lst.unlink()
    out = subprocess.run(["bash", "-c", block.replace("/etc/permtracker/backup-extra.list", str(lst)) + 'echo "${#EXTRA[@]}"'],
                         capture_output=True, text=True, check=True).stdout.strip()
    check(out == "0", "no list, no extra paths")

print(f"{len(failures)} failed")
sys.exit(1 if failures else 0)
