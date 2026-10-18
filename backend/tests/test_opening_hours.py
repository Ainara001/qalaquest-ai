"""OSM opening_hours → open / closed / unknown (Astana time, UTC+5)."""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.opening_hours import is_open, status

AST = timezone(timedelta(hours=5))


def at(day: int, hh: int, mm: int = 0) -> datetime:
    # 2026-10-19 is a Monday
    return datetime(2026, 10, 19 + day, hh, mm, tzinfo=AST)


@pytest.mark.parametrize("spec,when,expected", [
    ("24/7", at(3, 3), True),
    ("Mo-Fr 09:00-18:00", at(0, 10), True),
    ("Mo-Fr 09:00-18:00", at(0, 18, 30), False),
    ("Mo-Fr 09:00-18:00", at(5, 12), False),           # Saturday not listed → closed
    ("Mo-Fr 09:00-18:00; Sa 10:00-16:00", at(5, 12), True),
    ("Mo-Su 10:00-02:00", at(1, 1, 30), True),         # past midnight from Monday
    ("Mo-Su 10:00-02:00", at(1, 3), False),
    ("Mo-Su 09:00-21:00; Su off", at(6, 12), False),
    ("10:00-22:00", at(2, 21), True),
    ("Mo,We 10:00-14:00,15:00-19:00", at(2, 14, 30), False),
    ("Mo,We 10:00-14:00,15:00-19:00", at(2, 15, 30), True),
    ("Mo-Fr 09:00-18:00; PH off", at(0, 10), None),    # unsupported → unknown, never guessed
    ("sunrise-sunset", at(0, 10), None),
    (None, at(0, 10), None),
    ("", at(0, 10), None),
])
def test_is_open(spec, when, expected):
    assert is_open(spec, when) is expected


def test_status_words():
    assert status("24/7") == "open"
    assert status("by appointment") == "unknown"
