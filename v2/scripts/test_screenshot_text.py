"""lib_screenshot_text: what a screenshot's kept text loses, and how a picture is read."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib_screenshot_text as shots  # noqa: E402


def main() -> int:
    failures = 0

    def check(ok: bool, what: str) -> None:
        nonlocal failures
        print(("  ok   " if ok else "  FAIL ") + what)
        failures += not ok

    text = ("Receipt Number IOE 0912345678 and EAC2190123456, A-Number A-123-456-789 or A123456789, "
            "case G-100-26062-674975, mail me at a.b+c@x.co or (415) 555-0199. On November 18, 2026, we approved your Form I-765.")
    out = shots.redact(text)
    for gone in ("0912345678", "2190123456", "123-456-789", "A123456789", "674975", "a.b+c@x.co", "555-0199"):
        check(gone not in out, f"loses {gone}")
    check("On November 18, 2026, we approved your Form I-765." in out, "keeps the dates and the step")
    check(shots.read_picture(b"") == "" and shots.read_picture(b"x" * (shots.MAX_BYTES + 1)) == "",
          "reads nothing from an empty or oversized picture")
    check(shots.read_picture(b"not a picture") == "", "an unreadable picture gives empty text, never an error")
    font = next((f for f in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
                 if Path(f).exists()), None)
    if shutil.which("tesseract") and font:
        import io
        from PIL import Image, ImageDraw, ImageFont
        img = Image.new("RGB", (900, 120), "white")
        ImageDraw.Draw(img).text((20, 35), "Approved on November 18, 2026", fill="black", font=ImageFont.truetype(font, 40))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        check("November 18, 2026" in shots.read_picture(buf.getvalue()), "reads a picture's text from memory")
    else:
        print("  skip reading a picture: no tesseract or no font here")
    print(f"{failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
