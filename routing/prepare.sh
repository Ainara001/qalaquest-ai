#!/usr/bin/env bash
# Download the OpenStreetMap extract used by the Valhalla pedestrian router (resumable, retried).
# Data © OpenStreetMap contributors, ODbL. Re-run to update; delete routing/data/valhalla_tiles* to force a rebuild.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data
URL="${VALHALLA_PBF_URL:-https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf}"
for i in $(seq 1 30); do
  curl -L -C - --retry 5 --retry-delay 3 -sS -o data/kazakhstan-latest.osm.pbf "$URL" && break
  echo "download interrupted, retry $i" >&2
  sleep 3
done
ls -lh data/kazakhstan-latest.osm.pbf
echo "Now run: docker compose up -d valhalla   (first start builds the routing tiles)"
