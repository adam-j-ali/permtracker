#!/usr/bin/env python3
"""A failed LCA dump never costs the main database its sealed off-site copy.

bin/permtracker-backup dumps the main database, seals it and sends it to R2, and only then dumps the LCA
database, in its own subshell. This runs the real script in a scratch folder, with every path it touches moved
there and stand-ins for curl, zstd, openssl, rclone and systemctl, and checks three nights:

- the LCA dump fails: the main copy still lands in R2 (OFFSITE_OK), no lca .part file is left, and the run
  still ends red;
- the LCA dump works: both copies land, LCA_OK records the signature, and the run ends green;
- the LCA database hasn't changed: nothing is dumped for it, and the run ends green.

The script uses GNU stat and sha256sum, as the server does, so this runs on Linux (CI) and says it skipped
elsewhere.
Run: python3 scripts/oracle/test_backup_order.py
"""
from __future__ import annotations

import os
import pathlib
import platform
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = (HERE / "bin" / "permtracker-backup").read_text()

failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok:
        failures.append(msg)


STUBS = {
    # The main database answers a whole dump; the LCA one fails when LCA_FAIL is set.
    "curl": """#!/bin/bash
for a in "$@"; do case "$a" in *8082*) [ -n "$LCA_FAIL" ] && { echo "curl: (28) timed out" >&2; exit 28; }; echo "lca rows"; echo "COMMIT;"; exit 0;; *8080*) echo "main rows"; echo "COMMIT;"; exit 0;; esac; done
exit 2
""",
    "zstd": """#!/bin/bash
out=""; dc=0; file=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -dc) dc=1; shift;; -*) shift;; *) file="$1"; shift;; esac; done
if [ "$dc" = 1 ]; then cat "$file"; else cat > "$out"; fi
""",
    "openssl": """#!/bin/bash
in=""; out=""
while [ $# -gt 0 ]; do case "$1" in -in) in="$2"; shift 2;; -out) out="$2"; shift 2;; *) shift;; esac; done
cp "$in" "$out"
""",
    "rclone": """#!/bin/bash
case "$1" in
  copyto) mkdir -p "$BUCKET/$(dirname "${3#r2:permtracker-backups/}")"; cp "$2" "$BUCKET/${3#r2:permtracker-backups/}";;
  lsjson) f="$BUCKET/${2#r2:permtracker-backups/}"; if [ -f "$f" ]; then echo "[{\\"Size\\": $(stat -c %s "$f")}]"; else echo "[]"; fi;;
  size) echo '{"count": 1, "bytes": 1}';;
esac
""",
    "systemctl": "#!/bin/bash\nexit 0\n",
    "prune": "#!/bin/bash\nexit 0\n",
}


def night(lca_fail: bool, lca_ok_sig: str | None = None) -> tuple[int, pathlib.Path, str]:
    root = pathlib.Path(tempfile.mkdtemp(prefix="backup-order-"))
    bin_dir = root / "bin"
    bin_dir.mkdir()
    for name, body in STUBS.items():
        p = bin_dir / name
        p.write_text(body)
        p.chmod(0o755)
    srv = root / "srv"
    (srv / "backups").mkdir(parents=True)
    (srv / "secrets").mkdir()
    (srv / "secrets" / "db_ro.jwt").write_text("token")
    lca = srv / "db-lca" / "data.sqld" / "dbs" / "default"
    lca.mkdir(parents=True)
    (lca / "data").write_text("lca data")
    (lca / "wallog").write_text("log")
    etc = root / "etc"
    etc.mkdir()
    (etc / "r2.env").write_text("")
    (etc / "backup-recipient.pem").write_text("public key")
    (root / "r2-env").write_text("")
    (root / "bucket").mkdir()
    if lca_ok_sig is not None:
        sig = f"{(lca / 'data').stat().st_size}:{int((lca / 'data').stat().st_mtime)}:{(lca / 'wallog').stat().st_size}"
        (srv / "backups" / "LCA_OK").write_text(f"2026-11-08T00:00:00Z 10 lca-old.sql.zst {sig}\n")
    script = (
        SCRIPT.replace("/srv/permtracker", str(srv))
        .replace("/etc/permtracker", str(etc))
        .replace("/usr/local/lib/permtracker/r2-env", str(root / "r2-env"))
        .replace("/usr/local/bin/permtracker-r2-prune", str(bin_dir / "prune"))
    )
    (root / "backup.sh").write_text(script)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "BUCKET": str(root / "bucket")}
    if lca_fail:
        env["LCA_FAIL"] = "1"
    run = subprocess.run(["bash", str(root / "backup.sh")], env=env, capture_output=True, text=True, timeout=60)
    return run.returncode, srv / "backups", run.stdout + run.stderr


def main() -> int:
    if platform.system() != "Linux":
        print("skipped: the backup script uses GNU stat and sha256sum, so this runs on Linux (CI) only")
        return 0

    code, backups, out = night(lca_fail=True)
    check(code != 0, f"a failed LCA dump still ends the run red (exit {code})")
    check((backups / "OFFSITE_OK").exists(), "the main database's sealed copy still went to R2")
    check(not list(backups.glob("lca-*.part")), "no lca .part file is left behind")
    check(not (backups / "LCA_OK").exists(), "LCA_OK doesn't move")
    check("main database's copies are in place" in out, "the log says the main copies are safe")

    code, backups, out = night(lca_fail=False)
    check(code == 0, f"a good night ends green (exit {code}): {out.strip()[-200:]}")
    check((backups / "OFFSITE_OK").exists() and (backups / "LCA_OK").exists(), "both copies are recorded")
    check(len((backups / "LCA_OK").read_text().split()) == 4 if (backups / "LCA_OK").exists() else False,
          "LCA_OK keeps its four fields, the signature last")

    code, backups, out = night(lca_fail=True, lca_ok_sig="same")
    check(code == 0 and "unchanged since" in out, "an unchanged LCA database isn't dumped, and the night is green")

    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
