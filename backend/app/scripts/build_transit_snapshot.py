"""Build the Astana public-transport snapshot used by "how to get there".

Sources (both optional, merged):
  1. OpenStreetMap route relations (bus, trolleybus, tram) from a PBF extract. Checked 2026-10: the Kazakhstan
     extract has 292 bus-like relations but none inside Astana, so this source currently adds nothing.
  2. An open GTFS feed (--gtfs). The only one found for Astana is the research dataset "From Raw GPS to GTFS"
     (Zenodo 10.5281/zenodo.15769359, CC BY 4.0, GPS data of July–September 2024) which covers 3 bus routes.

    pip install osmium
    python -m app.scripts.build_transit_snapshot routing/data/kazakhstan-latest.osm.pbf data/transit_snapshot.json.gz \
        [--gtfs gtfs_data.zip] [--skip-osm]

Output: {"generated_from": ..., "routes": [{"id", "mode", "ref", "name", "from", "to", "operator", "stops": [{"lat","lon","name","osm_id"}]}]}
Stops keep the member order of the OSM relation (the direction of travel). Only stops inside the Astana bounding
box are kept. Data © OpenStreetMap contributors, ODbL. No timetables and no real-time positions exist in this data.
"""
import gzip
import json
import sys
from datetime import datetime, timezone

try:
    import osmium
except ImportError:  # only needed for the OSM part
    osmium = None

BBOX = (51.0, 71.2, 51.35, 71.8)  # lat_min, lon_min, lat_max, lon_max (Astana and surroundings)
MODES = {"bus", "trolleybus", "tram", "share_taxi"}
STOP_ROLES = {"stop", "platform", "stop_entry_only", "stop_exit_only", "stop_entry", "stop_exit"}


def inside(lat: float, lon: float) -> bool:
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


def gtfs_routes(path: str) -> list[dict]:
    """One representative trip (the one with most stops) per route and direction."""
    import csv
    import io
    import zipfile
    from collections import Counter

    z = zipfile.ZipFile(path)

    def rows(name: str):
        member = next(n for n in z.namelist() if n.endswith(name))
        for enc in ("utf-8-sig", "cp1251"):
            try:
                text = io.TextIOWrapper(z.open(member), encoding=enc)
                yield from csv.DictReader(text, delimiter="\t")
                return
            except UnicodeDecodeError:
                continue

    routes = {r["route_id"]: r for r in rows("routes.txt")}
    stops = {s["stop_id"]: s for s in rows("stops.txt")}
    trip_dir = {(t["trip_id"]): (t["route_id"], t["direction_id"]) for t in rows("trips.txt")}
    counts: Counter = Counter()
    for st in rows("stop_times.txt"):
        counts[st["trip_id"]] += 1
    best: dict[tuple[str, str], str] = {}
    for trip, key in trip_dir.items():
        if key not in best or counts[trip] > counts[best[key]]:
            best[key] = trip
    chosen = set(best.values())
    seq: dict[str, list[tuple[int, str]]] = {t: [] for t in chosen}
    for st in rows("stop_times.txt"):
        if st["trip_id"] in chosen:
            seq[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))
    out = []
    for (route_id, direction), trip in best.items():
        r = routes[route_id]
        pts = []
        for _, sid in sorted(seq[trip]):
            s = stops[sid]
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
            if inside(lat, lon) and (not pts or pts[-1]["osm_id"] != sid):
                pts.append({"osm_id": sid, "lat": round(lat, 6), "lon": round(lon, 6), "name": s["stop_name"]})
        if len(pts) >= 2:
            mode = {"0": "tram", "3": "bus", "11": "trolleybus"}.get(r.get("route_type", "3"), "bus")
            out.append({"id": f"gtfs:{route_id}:{direction}", "mode": mode, "ref": r.get("route_short_name"), "name": r.get("route_long_name"),
                        "from": pts[0]["name"], "to": pts[-1]["name"], "operator": "City Transportation Systems", "source": "gtfs-zenodo-15769359", "stops": pts})
    return out


def main(src: str, dst: str, gtfs: str | None = None, skip_osm: bool = False) -> None:
    routes, need = [], set()
    for rel in ([] if (skip_osm or osmium is None) else osmium.FileProcessor(src, osmium.osm.RELATION)):
        t = rel.tags
        if t.get("type") != "route" or t.get("route") not in MODES:
            continue
        members = [(m.ref, m.role) for m in rel.members if m.type == "n" and m.role in STOP_ROLES]
        if len(members) < 2:
            continue
        routes.append({"id": rel.id, "mode": t["route"], "ref": t.get("ref"), "name": t.get("name"), "from": t.get("from"), "to": t.get("to"),
                       "operator": t.get("operator"), "members": members})
        need.update(r for r, _ in members)
    print(f"candidate relations: {len(routes)}, stop nodes needed: {len(need)}", file=sys.stderr)

    nodes: dict[int, tuple[float, float, str | None]] = {}
    for n in ([] if (skip_osm or osmium is None) or not need else osmium.FileProcessor(src, osmium.osm.NODE)):
        if n.id in need and n.location.valid():
            nodes[n.id] = (n.location.lat, n.location.lon, n.tags.get("name"))

    out = []
    for r in routes:
        stops, seen = [], set()
        for ref, _ in r.pop("members"):
            if ref in nodes and inside(nodes[ref][0], nodes[ref][1]) and ref not in seen:
                seen.add(ref)
                lat, lon, name = nodes[ref]
                stops.append({"osm_id": ref, "lat": round(lat, 6), "lon": round(lon, 6), "name": name})
        if len(stops) >= 2:
            r["stops"] = stops
            out.append(r)
    if gtfs:
        out.extend(gtfs_routes(gtfs))
    out.sort(key=lambda r: (r["mode"], str(r["ref"]), str(r["id"])))
    payload = {"generated_from": src.split("/")[-1], "generated_at": datetime.now(timezone.utc).isoformat(), "bbox": BBOX,
               "licence": "OSM routes © OpenStreetMap contributors (ODbL); GTFS routes: Zenodo 10.5281/zenodo.15769359 (CC BY 4.0)", "routes": out}
    with gzip.open(dst, "wt", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"routes in Astana: {len(out)}; distinct refs: {len({r['ref'] for r in out})}; wrote {dst}", file=sys.stderr)


if __name__ == "__main__":
    args = sys.argv[1:]
    gtfs_path = args[args.index("--gtfs") + 1] if "--gtfs" in args else None
    main(args[0], args[1], gtfs_path, "--skip-osm" in args)
