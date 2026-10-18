"""Events skeleton: iCal parsing, categories, de-duplication, time windows, expiry, honest empty answer."""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.services.events import classify, configured_sources, dedupe_key, is_current_or_future, overlaps, parse_ics, window

AST = timezone(timedelta(hours=5))
ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Концерт камерного оркестра
DTSTART:20261024T190000
DTEND:20261024T210000
LOCATION:Astana Opera
URL:https://example.org/e/1
END:VEVENT
BEGIN:VEVENT
SUMMARY:Выставка современного иск
 усства
DTSTART;VALUE=DATE:20261025
LOCATION:Национальный музей
END:VEVENT
BEGIN:VEVENT
DTSTART:20261024T190000Z
END:VEVENT
END:VCALENDAR"""


def test_parse_ics():
    evs = parse_ics(ICS, "Test source", "https://example.org/cal.ics")
    assert len(evs) == 2  # an event without a title is dropped
    a, b = evs
    assert a.category == "music" and a.time_confirmed and a.start_at == datetime(2026, 10, 24, 19, tzinfo=AST)
    assert a.source_url == "https://example.org/e/1" and a.venue == "Astana Opera"
    assert b.title == "Выставка современного искусства" and b.category == "exhibition"
    assert not b.time_confirmed  # date only → time not confirmed, never "on now"


def test_classify():
    assert classify("Спектакль «Абай»") == "theatre"
    assert classify("DJ party") == "party"
    assert classify("Лекция") == "other"


def test_dedupe_key_ignores_case_and_punctuation():
    t = datetime(2026, 10, 24, 19, tzinfo=AST)
    assert dedupe_key("Astana Opera", t, "Концерт!", None) == dedupe_key("astana  opera", t, "концерт", None)
    assert dedupe_key("Astana Opera", t, "Концерт", None) != dedupe_key("Astana Opera", t + timedelta(hours=1), "Концерт", None)


def test_expired_events_are_not_current():
    now = datetime(2026, 10, 24, 22, tzinfo=AST)
    assert not is_current_or_future(now - timedelta(hours=3), now - timedelta(minutes=1), now)
    assert is_current_or_future(now - timedelta(hours=1), None, now)  # running, no end time
    assert not is_current_or_future(now - timedelta(hours=4), None, now)
    assert not is_current_or_future(None, None, now)


def test_windows():
    mon_noon = datetime(2026, 10, 19, 12, tzinfo=AST)
    lo, hi = window("weekend", mon_noon)
    assert lo == datetime(2026, 10, 24, tzinfo=AST) and hi == datetime(2026, 10, 26, tzinfo=AST)
    lo, hi = window("evening", mon_noon)
    assert lo == datetime(2026, 10, 19, 18, tzinfo=AST)
    assert overlaps(datetime(2026, 10, 19, 19, tzinfo=AST), None, lo, hi)
    assert not overlaps(datetime(2026, 10, 20, 12, tzinfo=AST), None, lo, hi)


def test_sources_are_off_by_default():
    assert configured_sources(None) == []
    assert configured_sources("not json") == []
    assert configured_sources('[{"name": "X", "type": "ical", "url": "https://x/cal.ics"}]')[0]["name"] == "X"


def test_events_api_validation():
    from app.main import app

    c = TestClient(app)
    assert c.get("/api/events?when=yesterday").status_code == 422
    assert c.get("/api/events?category=circus").status_code == 422
    assert c.get("/api/events?latitude=51.1").status_code == 422
