"""Minimal, conservative parser for OSM `opening_hours` (stage 7).

Supports the forms that cover most real values: "24/7", "Mo-Fr 09:00-18:00; Sa 10:00-16:00", "Mo,We 10:00-14:00,15:00-19:00",
"Mo-Su 10:00-02:00" (past midnight), "Su off", rules without days ("10:00-22:00").
Anything else (public holidays, months, weeks, sunrise, comments, "open"/"closed" words, "+" ...) → None = unknown.
The answer is never guessed: unknown stays unknown and the UI says "hours not confirmed".
"""
import re
from datetime import datetime, timedelta, timezone

ASTANA_TZ = timezone(timedelta(hours=5))  # Astana: UTC+5 all year
DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
_TIME = r"(\d{1,2}):(\d{2})"
_RANGE = re.compile(rf"^{_TIME}-{_TIME}$")
_DAYS = re.compile(r"^(Mo|Tu|We|Th|Fr|Sa|Su)(-(Mo|Tu|We|Th|Fr|Sa|Su))?$")


def _days(spec: str) -> set[int] | None:
    out: set[int] = set()
    for part in spec.split(","):
        m = _DAYS.match(part.strip())
        if not m:
            return None
        a = DAYS.index(m.group(1))
        b = DAYS.index(m.group(3)) if m.group(3) else a
        i = a
        while True:
            out.add(i)
            if i == b:
                break
            i = (i + 1) % 7
    return out


def _ranges(spec: str) -> list[tuple[int, int]] | None:
    out = []
    for part in spec.split(","):
        m = _RANGE.match(part.strip())
        if not m:
            return None
        h1, m1, h2, m2 = map(int, m.groups())
        if h1 > 24 or h2 > 48 or m1 > 59 or m2 > 59:
            return None
        start, end = h1 * 60 + m1, h2 * 60 + m2
        if end <= start:  # past midnight
            end += 24 * 60
        out.append((start, end))
    return out


def parse(spec: str | None) -> dict[int, list[tuple[int, int]]] | None:
    """weekday -> list of (start_min, end_min) intervals; None when the value is outside the supported subset."""
    if not spec:
        return None
    s = spec.strip()
    if s == "24/7":
        return {d: [(0, 24 * 60)] for d in range(7)}
    week: dict[int, list[tuple[int, int]]] = {}
    for rule in [r.strip() for r in s.split(";") if r.strip()]:
        parts = rule.split(None, 1)
        if _DAYS.match(parts[0].split(",")[0]) and len(parts) == 2:
            days, times = _days(parts[0]), parts[1].strip()
        elif _RANGE.match(rule.split(",")[0].strip()):
            days, times = set(range(7)), rule
        else:
            return None
        if days is None:
            return None
        if times == "off":
            for d in days:
                week[d] = []
            continue
        ranges = _ranges(times)
        if ranges is None:
            return None
        for d in days:  # a later rule for the same day replaces the earlier one (OSM semantics)
            week[d] = list(ranges)
    return week


def is_open(spec: str | None, at: datetime) -> bool | None:
    """True / False when the hours are parseable, None when unknown. `at` is converted to Astana time."""
    week = parse(spec)
    if week is None:
        return None
    local = at.astimezone(ASTANA_TZ)
    minute = local.hour * 60 + local.minute
    today, yesterday = local.weekday(), (local.weekday() - 1) % 7
    if any(a <= minute < b for a, b in week.get(today, [])):
        return True
    # an interval of yesterday that runs past midnight
    if any(b > 24 * 60 and minute < b - 24 * 60 for a, b in week.get(yesterday, [])):
        return True
    # days missing from a rule set are closed only if the value lists days explicitly; otherwise unknown
    if today not in week and not any(b > 24 * 60 for a, b in week.get(yesterday, [])):
        return False if week else None
    return False


def status(spec: str | None, at: datetime | None = None) -> str:
    """'open' | 'closed' | 'unknown' for display and ranking."""
    v = is_open(spec, at or datetime.now(timezone.utc))
    return "unknown" if v is None else "open" if v else "closed"
