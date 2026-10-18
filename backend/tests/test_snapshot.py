import pytest

from app.integrations.overpass import OverpassError, RecordingClient, SnapshotClient


class FakeLive:
    def query(self, ql):
        return {"elements": [{"type": "node", "id": 1, "q": ql}]}

    def close(self):
        pass


def test_snapshot_roundtrip(tmp_path):
    path = str(tmp_path / "snap.json.gz")
    rec = RecordingClient(FakeLive(), path)
    live = rec.query("[out:json];node(1);out;")
    rec.close()
    snap = SnapshotClient(path)
    assert snap.query("[out:json];node(1);out;") == live
    with pytest.raises(OverpassError):  # unknown query behaves like an unavailable server
        snap.query("[out:json];node(2);out;")


def test_bundled_snapshot_is_readable():
    snap = SnapshotClient("data/osm_snapshot.json.gz")
    assert len(snap.data) >= 10
