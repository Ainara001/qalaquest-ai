"""Public-transport options from OpenStreetMap route relations (bus, trolleybus, tram) in Astana.

What this is: for a start and a destination, which known bus/tram lines have a stop near the start and, further
along the same direction of travel, a stop near the destination. COVERAGE IS PARTIAL: OpenStreetMap has no
public-transport route relations inside Astana and no official open feed exists, so the data is the open research
GTFS of 3 bus lines (see app/scripts/build_transit_snapshot.py). There is no timetable, no frequency and no
real-time position, so waiting time is not included and every ride time is an estimate at an average city speed. Walking to / from the stops is computed by the pedestrian router when it is
available (otherwise a straight-line estimate, labelled as such).
"""
import gzip
import json
import logging
import math
from pathlib import Path

from app.integrations.valhalla import NoRoute, RoutingUnavailable, ValhallaClient
from app.schemas.transit import TransitOption, TransitResponse, TransitStop

log = logging.getLogger("transit")
SNAPSHOT = Path(__file__).resolve().parents[2] / "data" / "transit_snapshot.json.gz"
WALK_KMH = 4.8
BUS_KMH = {"bus": 16.0, "trolleybus": 15.0, "tram": 17.0, "share_taxi": 20.0}  # average with stops; an estimate
ROAD_FACTOR = 1.25  # straight segments between stops → typical street distance
DWELL_MIN = 0.4  # per intermediate stop
MAX_OPTIONS = 4


def _hav(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    h = math.sin(math.radians(la2 - la1) / 2) ** 2 + math.cos(math.radians(la1)) * math.cos(math.radians(la2)) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


class TransitService:
    def __init__(self, valhalla: ValhallaClient) -> None:
        self.valhalla = valhalla
        self._data: dict | None = None

    def _load(self) -> dict:
        if self._data is None:
            try:
                with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as f:
                    self._data = json.load(f)
            except (OSError, ValueError):
                log.warning("transit snapshot missing or unreadable: %s", SNAPSHOT)
                self._data = {"routes": [], "generated_at": None}
        return self._data

    def _candidates(self, o: tuple[float, float], d: tuple[float, float], max_walk: int) -> list[dict]:
        best: dict[tuple[str, str | None], dict] = {}
        for r in self._load()["routes"]:
            stops = r["stops"]
            near_o = [(i, _hav(o, (s["lat"], s["lon"]))) for i, s in enumerate(stops)]
            near_o = [(i, w) for i, w in near_o if w <= max_walk]
            near_d = [(j, _hav(d, (s["lat"], s["lon"]))) for j, s in enumerate(stops)]
            near_d = [(j, w) for j, w in near_d if w <= max_walk]
            pick = None
            for i, wo in near_o:
                for j, wd in near_d:
                    if j - i < 2:  # at least two stops of riding, in the direction of travel
                        continue
                    ride = sum(_hav((stops[k]["lat"], stops[k]["lon"]), (stops[k + 1]["lat"], stops[k + 1]["lon"])) for k in range(i, j)) * ROAD_FACTOR
                    minutes = ride / (BUS_KMH.get(r["mode"], 16.0) * 1000 / 60) + DWELL_MIN * (j - i - 1)
                    cost = (wo + wd) * 1.3 / (WALK_KMH * 1000 / 60) + minutes
                    if pick is None or cost < pick["cost"]:
                        pick = {"route": r, "i": i, "j": j, "wo": wo, "wd": wd, "ride_m": ride, "ride_min": minutes, "cost": cost}
            if pick is None:
                continue
            key = (r["mode"], r["ref"] or r["name"])
            if key not in best or pick["cost"] < best[key]["cost"]:  # the two directions / variants of a line: keep the best
                best[key] = pick
        return sorted(best.values(), key=lambda c: c["cost"])[:MAX_OPTIONS]

    async def options(self, start: tuple[float, float], dest: tuple[float, float], max_walk: int = 600) -> TransitResponse:
        data = self._load()
        cands = self._candidates(start, dest, max_walk)
        pts = [start, dest]
        for c in cands:
            s = c["route"]["stops"]
            pts += [(s[c["i"]]["lat"], s[c["i"]]["lon"]), (s[c["j"]]["lat"], s[c["j"]]["lon"])]
        method, matrix = "pedestrian_route", None
        try:
            matrix = await self.valhalla.matrix(pts, WALK_KMH)
        except (RoutingUnavailable, NoRoute):
            method = "geodesic_straight_line"

        def walk(a: int, b: int) -> tuple[float, int]:
            cell = matrix[a][b] if matrix else None
            if cell is not None:
                return cell[0], max(1, round(cell[1] / 60))
            d = _hav(pts[a], pts[b])
            return d, max(1, round(d * 1.3 / (WALK_KMH * 1000 / 60)))

        wo_m, wo_min = walk(0, 1)
        out: list[TransitOption] = []
        for n, c in enumerate(cands):
            r, st = c["route"], c["route"]["stops"]
            bi, ai = 2 + 2 * n, 3 + 2 * n
            bm, bmin = walk(0, bi)
            am, amin = walk(ai, 1)
            ride_min = max(1, round(c["ride_min"]))
            total = bmin + ride_min + amin
            def stop(idx: int, m: float, mins: int) -> TransitStop:
                s = st[idx]
                return TransitStop(stop_id=str(s["osm_id"]), name=s["name"], latitude=s["lat"], longitude=s["lon"], walk_m=round(m), walk_minutes=mins, walk_method=method)
            out.append(TransitOption(
                mode=r["mode"], ref=r["ref"], name=r["name"], direction_from=r["from"], direction_to=r["to"], operator=r["operator"],
                board=stop(c["i"], bm, bmin), alight=stop(c["j"], am, amin), stops_count=c["j"] - c["i"], ride_distance_m=round(c["ride_m"]),
                ride_minutes=ride_min, total_minutes=total, saves_minutes=wo_min - total, osm_url=(f"https://www.openstreetmap.org/relation/{r['id']}" if str(r["id"]).isdigit() else "https://doi.org/10.5281/zenodo.15769359"),
            ))
        out.sort(key=lambda o: o.total_minutes)
        return TransitResponse(options=out, walk_only_minutes=wo_min, walk_only_distance_m=round(wo_m), walk_method=method,
                               routes_in_data=len({(r["mode"], r["ref"] or r["name"]) for r in data["routes"]}), data_generated_at=data.get("generated_at"))


_svc: TransitService | None = None


def get_transit() -> TransitService:
    global _svc
    if _svc is None:
        from app.integrations.valhalla import get_valhalla

        _svc = TransitService(get_valhalla())
    return _svc
