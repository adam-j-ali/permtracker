"""The pages a USCIS sample load names for Cloudflare's purge: the blocks list, then each block's two pages."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sample_pages as sp  # noqa: E402


def test_each_block_and_its_numbers_page_after_the_list():
    got = sp.sample_pages({"by_block": {"IOE09363": {}, "IOE09358": {"_checked": 100000}, "_meta": {}, "bad block": {}}})
    assert got == ["/uscis-receipt-blocks", "/uscis-receipt-blocks/IOE09358", "/uscis-receipt-blocks/IOE09358/numbers",
                   "/uscis-receipt-blocks/IOE09363", "/uscis-receipt-blocks/IOE09363/numbers"]


def test_no_blocks_still_names_the_list():
    assert sp.sample_pages({}) == ["/uscis-receipt-blocks"]


if __name__ == "__main__":
    test_each_block_and_its_numbers_page_after_the_list()
    test_no_blocks_still_names_the_list()
    print("ok")
