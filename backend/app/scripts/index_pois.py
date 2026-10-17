"""Build / refresh the POI vector index (embeddings).

    python -m app.scripts.index_pois           # only new or changed POIs
    python -m app.scripts.index_pois --force   # re-embed everything
"""
import argparse
import json
import logging
import os
import sys

from app.core.logging import setup_logging
from app.db.session import SessionLocal
from app.rag.embeddings import get_embedding_service


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-embed even unchanged documents")
    args = parser.parse_args()
    setup_logging(os.getenv("LOG_LEVEL", "INFO"))
    stats = get_embedding_service().index_all(SessionLocal, force=args.force)
    logging.getLogger("index_pois").info("done: %s", json.dumps(stats))
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
