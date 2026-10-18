"""Stage 6 endpoints reject invalid input with 422 before any database or AI work (Pydantic validation)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
MEMBER = {"interests": ["architecture"], "mood": "photo", "time_minutes": 60}


@pytest.mark.parametrize("body", [
    {"members": [MEMBER]},                                   # fewer than 2 participants
    {"members": [MEMBER] * 6},                               # more than 5
    {"members": [MEMBER, {**MEMBER, "weights": {"x": 1}}]},  # unknown field in a member
    {"members": [MEMBER, {**MEMBER, "mood": "sleepy"}]},     # unknown mood
    {"members": [MEMBER, MEMBER], "places_count": 4},        # at most 3 places
    {"members": [MEMBER, MEMBER], "debug": True},            # unknown top-level field
])
def test_group_request_validation(body):
    r = client.post("/api/ai/groups/recommend", json=body)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("body", [
    {"quest_type": "treasure"},
    {"quest_type": "photo_hunt", "tasks_count": 1},
    {"quest_type": "photo_hunt", "tasks_count": 6},
    {"quest_type": "history", "time_minutes": 2},
])
def test_quest_request_validation(body):
    assert client.post("/api/ai/quests/generate", json=body).status_code == 422


@pytest.mark.parametrize("body", [
    {"exclude_poi_ids": list(range(101))},
    {"location": {"latitude": 95, "longitude": 71.4}},
    {"personalization": {"session": {"mood": "angry"}}},
    {"seed": -1},
    {"lang": "en"},
])
def test_surprise_request_validation(body):
    assert client.post("/api/ai/surprise", json=body).status_code == 422


def test_search_accepts_only_known_moods():
    r = client.post("/api/ai/search", json={"personalization": {"session": {"mood": "angry"}}})
    assert r.status_code == 422


@pytest.mark.parametrize("params", ["", "?q=", "?q=%20%20", "?q=abc&latitude=51.1", "?q=abc&limit=50"])
def test_suggest_validation(params):
    assert client.get(f"/api/pois/suggest{params}").status_code == 422
