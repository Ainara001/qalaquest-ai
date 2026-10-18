"""Local events (stage 7): ETL skeleton for VERIFIED sources only, time windows, honesty rules.

No source is connected by default (`EVENT_SOURCES` is empty) because none has been checked for the legal right to
automated collection. Nothing is ever generated: with no sources the API says so and returns no events.

Connecting a source (after checking its terms / robots.txt):
    EVENT_SOURCES='[{"name": "Astana Opera", "type": "ical", "url": "https://…/events.ics", "terms": "public iCal, reuse allowed"}]'
    python -m app.scripts.import_events

Rules: dedupe by venue + start time + title/url; expired events are never shown as current; an event without a
confirmed time is `time_unconfirmed` and never presented as "on now"; an event whose venue is not matched to a real
POI has no coordinates (`place_unconfirmed`) and is not put on the map.
"""
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from app.core.opening_hours import ASTANA_TZ

log = logging.getLogger("events")
CATEGORIES = ("exhibition", "music", "party", "theatre", "other")
WHEN = ("today", "tomorrow", "weekend", "evening", "upcoming")
EXPIRY_GRACE = timedelta(hours=3)  # an event without an end time is treated as running up to 3 h after its start

_CATEGORY_WORDS = [
    ("exhibition", r"выставк|экспозиц|exhibit|көрме|галере"),
    ("theatre", r"спектак|театр|опер|балет|theatre|theater|мюзикл|қойылым"),
    ("music", r"концерт|музык|джаз|оркестр|concert|music|jazz|live|ән кеші|концерті"),
    ("party", r"вечеринк|party|dj\b|диджей|кеш\b|тусовк"),
]


@dataclass
class RawEvent:
    title: str
    source_name: str
    source_url: str
    start_at: datetime | None = None
    end_at: datetime | None = None
    venue: str | None = None
    organizer: str | None = None
    description: str | None = None
    price: str | None = None
    age_limit: str | None = None
    url: str | None = None
    category: str = "other"
    time_confirmed: bool = True
    extra: dict = field(default_factory=dict)


def classify(text: str) -> str:
    t = (text or "").lower()
    for cat, rx in _CATEGORY_WORDS:
        if re.search(rx, t):
            return cat
    return "other"


def dedupe_key(venue: str | None, start: datetime | None, title: str, url: str | None) -> str:
    norm = lambda s: re.sub(r"\W+", " ", (s or "").lower()).strip()  # noqa: E731
    when = start.astimezone(timezone.utc).strftime("%Y%m%dT%H%M") if start else "-"
    return hashlib.sha256(f"{norm(venue)}|{when}|{norm(title) or norm(url)}".encode()).hexdigest()


# ------------------------------------------------------------------ iCal (RFC 5545, the subset real calendars use)

def _unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _unescape(v: str) -> str:
    return v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").strip()


def _dt(value: str, params: dict) -> tuple[datetime | None, bool]:
    """(datetime, time_confirmed). DATE-only values have no confirmed time."""
    v = value.strip()
    try:
        if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", v):
            d = date(int(v[:4]), int(v[4:6]), int(v[6:8]))
            return datetime.combine(d, time(0, 0), ASTANA_TZ), False
        base = datetime.strptime(v.rstrip("Z"), "%Y%m%dT%H%M%S")
        if v.endswith("Z"):
            return base.replace(tzinfo=timezone.utc), True
        # TZID or floating time: the sources we accept are Astana venues → local time (stated in the docs)
        return base.replace(tzinfo=ASTANA_TZ), True
    except ValueError:
        return None, False


def parse_ics(text: str, source_name: str, source_url: str) -> list[RawEvent]:
    events: list[RawEvent] = []
    cur: dict | None = None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {}
            continue
        if line == "END:VEVENT" and cur is not None:
            start, start_ok = _dt(*cur["DTSTART"]) if "DTSTART" in cur else (None, False)
            end, _ = _dt(*cur["DTEND"]) if "DTEND" in cur else (None, False)
            title = _unescape(cur.get("SUMMARY", ("", {}))[0])
            if title:
                desc = _unescape(cur.get("DESCRIPTION", ("", {}))[0]) or None
                ev = RawEvent(
                    title=title[:300], source_name=source_name, source_url=_unescape(cur.get("URL", (source_url, {}))[0]) or source_url,
                    start_at=start, end_at=end, venue=_unescape(cur.get("LOCATION", ("", {}))[0]) or None,
                    organizer=_unescape(cur.get("ORGANIZER", ("", {}))[0]).removeprefix("mailto:") or None,
                    description=desc[:1000] if desc else None, time_confirmed=start_ok,
                )
                ev.category = classify(f"{title} {_unescape(cur.get('CATEGORIES', ('', {}))[0])} {desc or ''}")
                events.append(ev)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        head, value = line.split(":", 1)
        name, *params = head.split(";")
        cur[name.upper()] = (value, dict(p.split("=", 1) for p in params if "=" in p))
    return events


# ------------------------------------------------------------------ time windows (Astana local time)

def window(when: str, now: datetime) -> tuple[datetime, datetime]:
    local = now.astimezone(ASTANA_TZ)
    midnight = datetime.combine(local.date(), time(0, 0), ASTANA_TZ)
    if when == "today":
        return now, midnight + timedelta(days=1)
    if when == "tomorrow":
        return midnight + timedelta(days=1), midnight + timedelta(days=2)
    if when == "evening":
        return max(now, midnight + timedelta(hours=18)), midnight + timedelta(days=1, hours=2)
    if when == "weekend":
        wd = local.weekday()
        if wd >= 5:  # Saturday / Sunday: from now until Monday 00:00
            return now, midnight + timedelta(days=7 - wd)
        sat = midnight + timedelta(days=5 - wd)
        return sat, sat + timedelta(days=2)
    return now, now + timedelta(days=30)


def is_current_or_future(start: datetime | None, end: datetime | None, now: datetime) -> bool:
    """Expired events are never offered as current."""
    if end is not None:
        return end >= now
    if start is not None:
        return start + EXPIRY_GRACE >= now
    return False  # no date at all: not shown as an upcoming event


def overlaps(start: datetime | None, end: datetime | None, lo: datetime, hi: datetime) -> bool:
    if start is None:
        return False
    return start < hi and (end or start + EXPIRY_GRACE) >= lo


def configured_sources(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except ValueError:
        log.warning("EVENT_SOURCES is not valid JSON; no event sources connected")
        return []
    return [s for s in items if isinstance(s, dict) and s.get("type") == "ical" and s.get("url") and s.get("name")]
