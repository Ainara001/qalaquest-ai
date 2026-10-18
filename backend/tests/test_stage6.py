"""Stage 6: mood/context merge, Surprise Me, AI Quest and Group Harmony — the parts that decide what the user sees."""
import random

from app.rag.taxonomy import MAP_MOODS, MOOD_INTERESTS, Mood
from app.schemas.ai import QueryIntent
from app.schemas.context import GroupMember
from app.schemas.personalization import PersonalizationInput, SessionPreferences, UserPreferences
from app.services.group import common_constraints, normalised_fits, rank_sets
from app.services.personalization import PersonalizationService
from app.services.quest import QUEST_TYPES, build_tasks, template_for
from app.services.surprise import novelty_of, pick_surprise, reasons_for


# ----------------------------------------------------------------- moods and the shared context

def test_every_stage6_mood_has_interests():
    assert set(MAP_MOODS) <= set(MOOD_INTERESTS)
    assert {"romantic", "learn", "photo", "relax"} <= set(MAP_MOODS)
    assert set(MOOD_INTERESTS) == set(Mood.__args__)


def test_mood_interests_are_marked_as_mood(emb):
    ctx = PersonalizationService(emb).build(None, p=PersonalizationInput(session=SessionPreferences(mood="photo")))
    assert ctx.mood == "photo"
    assert {src for _, src in ctx.interests.values()} == {"mood"}
    assert "photo" in ctx.interests


def test_time_from_the_message_beats_the_walk_context(emb):
    p = PersonalizationInput(session=SessionPreferences(time_minutes=90))
    ctx = PersonalizationService(emb).build(None, p=p, intent=QueryIntent(time_minutes=30))
    assert ctx.time_minutes == 30
    ctx = PersonalizationService(emb).build(None, p=p)
    assert ctx.time_minutes == 90


def test_romantic_atmosphere_in_the_text_ranks_as_a_request_interest(emb):
    ctx = PersonalizationService(emb).build(None, p=None, intent=QueryIntent(atmosphere="romantic"))
    assert ctx.interests["romantic"][1] == "request"


def test_profile_is_ignored_when_switched_off(emb):
    p = PersonalizationInput(use_profile=False, profile=UserPreferences(interests=["coffee"]), session=SessionPreferences(mood="relax"))
    ctx = PersonalizationService(emb).build(None, p=p)
    assert "coffee" not in ctx.interests or ctx.interests["coffee"][1] != "profile"
    assert ctx.mood == "relax"


# ----------------------------------------------------------------- Surprise Me

def test_surprise_prefers_new_categories_but_stays_relevant(cand):
    pool = [cand(1, "cafe", 0.9), cand(2, "gallery", 0.6), cand(3, "park", 0.1)]
    picks = {pick_surprise(pool, known={"cafe"}, shown=set(), rnd=random.Random(s))[0].poi.id for s in range(40)}
    assert 2 in picks  # a relevant new category is offered
    counts = [pick_surprise(pool, known={"cafe"}, shown=set(), rnd=random.Random(s))[0].poi.id for s in range(200)]
    assert counts.count(2) > counts.count(3)  # relevance still matters


def test_novelty_is_history_based():
    from tests.conftest import make_candidate

    c = make_candidate(1, "museum")
    assert novelty_of(c, set(), set()) == 1.0  # (candidate, known categories, categories shown in this session)
    assert novelty_of(c, {"museum"}, set()) < 1.0
    assert novelty_of(c, set(), {"museum"}) < novelty_of(c, {"museum"}, set())


def test_surprise_on_empty_pool_is_none():
    assert pick_surprise([], set(), set(), random.Random(1)) is None


def test_surprise_reasons_come_from_the_ranking(emb, cand):
    ctx = PersonalizationService(emb).build(None, p=PersonalizationInput(session=SessionPreferences(mood="unusual")))
    c = cand(1, "gallery", matched=[("unusual", "mood")], distance=500)
    c.weather_fit = "indoor_in_adverse_weather"
    r = reasons_for(c, 1.0, ctx)
    assert {"mood", "new_category", "unusual_category", "indoor_in_adverse_weather", "close", "not_shown_before"} <= set(r)
    assert "interests" not in r  # nothing matched the profile


# ----------------------------------------------------------------- AI Quest

def test_quest_tasks_are_bound_to_real_stops_and_facts(cand):
    stops = [cand(1, "monument", tags={"historic": "memorial"}), cand(2, "museum", hours="Mo-Su 10:00-18:00")]
    tasks = build_tasks("history", stops, 4, "ru")
    assert 2 <= len(tasks) <= 4
    assert [t.id for t in tasks] == [f"t{i + 1}" for i in range(len(tasks))]
    assert tasks[0].poi_ids == [1] and tasks[0].template == "read_on_site" and "historic=memorial" in tasks[0].facts
    assert tasks[1].poi_ids == [2] and tasks[1].template == "museum_pick" and not tasks[1].hours_unknown
    assert all(set(t.poi_ids) <= {1, 2} for t in tasks)


def test_quest_with_one_reachable_place_still_has_two_tasks(cand):
    tasks = build_tasks("photo_hunt", [cand(1, "attraction")], 5, "ru")
    assert len(tasks) == 2 and {t.template for t in tasks} == {"photo_angle", "three_unnoticed"}


def test_quest_task_count_is_capped(cand):
    stops = [cand(1, "park"), cand(2, "public_space"), cand(3, "cafe")]
    for n in (2, 3, 4, 5):
        assert len(build_tasks("explorer", stops, n, "ru")) == n
    assert any(t.template == "two_public_spaces" for t in build_tasks("explorer", stops, 5, "ru"))


def test_every_quest_type_has_a_template_for_every_category():
    from app.rag.taxonomy import VISIT_MINUTES

    for qt in QUEST_TYPES:
        for cat in VISIT_MINUTES:
            assert template_for(qt, cat)


# ----------------------------------------------------------------- Group Harmony

def test_group_example_from_the_spec_covers_everyone(cand):
    pool = [cand(1, "architecture", 0.6, {"building": "mosque"}), cand(2, "cafe", 0.5, {"cuisine": "coffee_shop"}),
            cand(3, "museum", 0.55, {"tourism": "museum"}), cand(4, "park", 0.62), cand(5, "monument", 0.58, {"historic": "memorial"}),
            cand(6, "mall", 0.4)]
    members = [GroupMember(interests=["architecture", "photo"]), GroupMember(interests=["coffee", "quiet"]),
               GroupMember(interests=["museums", "history"])]
    norm = normalised_fits(pool, members)
    obj, best = rank_sets(pool, norm, 3)[0]
    satisfaction = [max(norm[c.poi.id][k] for c in best) for k in range(3)]
    assert min(satisfaction) >= 0.5  # nobody is left without a fitting place
    assert 6 not in {c.poi.id for c in best}  # the mall fits nobody


def test_group_min_term_prevents_one_member_dominating(cand):
    # three architecture places would delight A only; a mixed set must win
    pool = [cand(1, "architecture", 0.9), cand(2, "architecture", 0.9), cand(3, "monument", 0.9), cand(4, "cafe", 0.3)]
    members = [GroupMember(interests=["architecture"]), GroupMember(interests=["coffee"])]
    norm = normalised_fits(pool, members)
    _, best = rank_sets(pool, norm, 3)[0]
    assert 4 in {c.poi.id for c in best}


def test_group_common_constraints_take_the_strictest():
    members = [GroupMember(time_minutes=120, pace="active", budget="5000"), GroupMember(time_minutes=45, pace="slow", budget="free", wheelchair=True)]
    c = common_constraints(members)
    assert c == {"time_minutes": 45, "budget": "free", "pace": "slow", "wheelchair": True, "with_children": False}


# ----------------------------------------------------------------- weather on the map

def test_weather_failure_is_not_retried_on_every_map_refresh():
    import asyncio
    import time

    import pytest

    from app.services.weather import WeatherService, WeatherUnavailable

    w = WeatherService()
    w._url, w._timeout = "http://127.0.0.1:9/closed", 2.0  # nothing listens there
    with pytest.raises(WeatherUnavailable):
        asyncio.run(w.report(51.1, 71.4))
    t = time.perf_counter()
    with pytest.raises(WeatherUnavailable):
        asyncio.run(w.report(51.1, 71.4))
    assert time.perf_counter() - t < 0.2  # answered from the failure memo, no second network wait
