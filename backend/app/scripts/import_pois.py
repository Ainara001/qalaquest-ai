"""Import real POIs of Astana from OpenStreetMap (Overpass API).

    python -m app.scripts.import_pois                    # all categories
    python -m app.scripts.import_pois -c museum -c park  # selected categories
    python -m app.scripts.import_pois --dry-run          # fetch + classify, write nothing
    python -m app.scripts.import_pois --dry-run --record data/osm_snapshot.json.gz   # save Overpass answers
    python -m app.scripts.import_pois --snapshot data/osm_snapshot.json.gz           # import without Overpass

Safe to re-run: records are keyed by (osm_type, osm_id) and updated in place.
"""
import argparse
import json
import logging
import os
import sys

from app.core.logging import setup_logging
from app.db.session import SessionLocal
from app.integrations.osm_categories import CATEGORIES
from app.integrations.overpass import DEFAULT_ENDPOINTS, OverpassClient, RecordingClient, SnapshotClient
from app.services.poi_import import run_import


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-c", "--category", action="append", choices=CATEGORIES, help="limit to a category (repeatable)")
    parser.add_argument("--dry-run", action="store_true", help="do not write to the database")
    parser.add_argument("--index", action="store_true", help="refresh the vector index after a successful import")
    parser.add_argument("--pause", type=float, default=3.0, help="seconds between Overpass requests (default 3)")
    parser.add_argument("--record", metavar="PATH", help="save the Overpass answers to a gzipped snapshot")
    parser.add_argument("--snapshot", metavar="PATH", help="read Overpass answers from a snapshot instead of the network")
    args = parser.parse_args()

    setup_logging(os.getenv("LOG_LEVEL", "INFO"))
    endpoints = os.getenv("OVERPASS_URLS")
    if args.snapshot:
        client = SnapshotClient(args.snapshot)
        args.pause = 0
    else:
        client = OverpassClient(
            endpoints=[u.strip() for u in endpoints.split(",")] if endpoints else DEFAULT_ENDPOINTS,
            user_agent=os.getenv("OVERPASS_USER_AGENT", "QalaQuestAI/0.2 (hackathon project)"),
        )
        if args.record:
            client = RecordingClient(client, args.record)
    try:
        result = run_import(SessionLocal, client, args.category, dry_run=args.dry_run, pause=args.pause)
    finally:
        client.close()
    logging.getLogger("import_pois").info("done: %s", json.dumps({k: result[k] for k in ("status", "failed", "totals")}))
    if args.index and result["status"] in ("success", "partial") and not args.dry_run:
        from app.rag.embeddings import get_embedding_service

        stats = get_embedding_service().index_all(SessionLocal)
        logging.getLogger("import_pois").info("index refreshed: %s", json.dumps(stats))
    return 0 if result["status"] in ("success", "partial") else 1


if __name__ == "__main__":
    sys.exit(main())
