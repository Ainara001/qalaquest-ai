"""Import events from the verified sources listed in EVENT_SOURCES (JSON). With no sources: does nothing and says so.

    python -m app.scripts.import_events            # import / refresh
    python -m app.scripts.import_events --dry-run  # fetch and parse only

Safe to re-run: events are keyed by dedupe_key (venue + start time + title/url) and updated in place.
A venue is linked to a real POI by name (same matcher as the AI start point); otherwise the event keeps no
coordinates and is marked place_unconfirmed, so it is never drawn at a guessed position.
"""
import argparse
import logging
import os
import sys
from datetime import datetime, timezone

import httpx
from sqlalchemy.dialects.postgresql import insert

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.session import SessionLocal
from app.models import Event
from app.services.anchor import find_anchor
from app.services.events import configured_sources, dedupe_key, parse_ics

log = logging.getLogger("import_events")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    setup_logging(os.getenv("LOG_LEVEL", "INFO"))
    sources = configured_sources(get_settings().event_sources)
    if not sources:
        print("No event sources connected (EVENT_SOURCES is empty). Nothing imported; the app shows no events.")
        return 0
    total = 0
    for src in sources:
        try:
            resp = httpx.get(src["url"], timeout=30, headers={"User-Agent": "QalaQuestAI/0.7 (event import; contact: repo owner)"})
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning("source %s failed: %s — existing events are kept", src["name"], type(exc).__name__)
            continue
        raw = parse_ics(resp.text, src["name"], src["url"])
        print(f"{src['name']}: {len(raw)} events parsed")
        if args.dry_run:
            continue
        now = datetime.now(timezone.utc)
        with SessionLocal() as db:
            for ev in raw:
                poi = find_anchor(db, ev.venue) if ev.venue else None
                status = "time_unconfirmed" if not ev.time_confirmed else "place_unconfirmed" if poi is None else "source_listed"
                row = dict(
                    dedupe_key=dedupe_key(ev.venue, ev.start_at, ev.title, ev.url), title=ev.title, category=ev.category,
                    venue=ev.venue, poi_id=poi.id if poi else None, latitude=poi.latitude if poi else None,
                    longitude=poi.longitude if poi else None, start_at=ev.start_at, end_at=ev.end_at, organizer=ev.organizer,
                    description=ev.description, price=None,  # price only when a source states it in a structured field
                    age_limit=ev.age_limit, source_name=ev.source_name, source_url=ev.url or ev.source_url,
                    verification_status=status, last_checked_at=now,
                )
                stmt = insert(Event).values(**row)
                db.execute(stmt.on_conflict_do_update(index_elements=["dedupe_key"], set_={k: v for k, v in row.items() if k != "dedupe_key"}))
                total += 1
            db.commit()
    print(f"Imported / refreshed: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
