"""Protection around AI endpoints: per-client rate limit, double-submit de-duplication, in-memory sessions."""
import asyncio
import hashlib
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, TypeVar

from fastapi import HTTPException

from app.core.config import get_settings

T = TypeVar("T")
DEDUPE_SECONDS = 8.0
SESSION_TTL = 2 * 3600
MAX_SESSIONS = 500
MAX_HISTORY = 8


class RateLimiter:
    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> None:
        now = time.monotonic()
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            retry = max(1, int(self.window - (now - q[0])))
            raise HTTPException(429, "Too many AI requests, slow down", headers={"Retry-After": str(retry)})
        q.append(now)
        if len(self._hits) > 5000:  # forget idle clients
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]:
                self._hits.pop(k, None)


class Deduper:
    """A second identical request arriving while the first runs (or within seconds) shares its result."""

    def __init__(self) -> None:
        self._entries: dict[str, tuple[asyncio.Task, float | None]] = {}

    @staticmethod
    def key(*parts: object) -> str:
        return hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()

    def lookup(self, key: str) -> asyncio.Task | None:
        entry = self._entries.get(key)
        if not entry:
            return None
        task, finished = entry
        if task.done():
            if task.cancelled() or task.exception() or (finished and time.monotonic() - finished > DEDUPE_SECONDS):
                self._entries.pop(key, None)
                return None
        return task

    def start(self, key: str, factory: Callable[[], Awaitable[T]]) -> asyncio.Task:
        task = asyncio.create_task(factory())
        self._entries[key] = (task, None)
        task.add_done_callback(lambda t: self._entries.__setitem__(key, (t, time.monotonic())) if key in self._entries else None)
        if len(self._entries) > 500:
            for k in list(self._entries)[:200]:
                self._entries.pop(k, None)
        return task


@dataclass
class Session:
    history: list[dict] = field(default_factory=list)  # {"role": "user"|"assistant", "text": str}
    constraints: dict = field(default_factory=dict)  # last merged QueryIntent (public fields only)
    shown_ids: list[int] = field(default_factory=list)
    touched: float = field(default_factory=time.monotonic)

    def add(self, role: str, text: str) -> None:
        self.history.append({"role": role, "text": text[:600]})
        self.history = self.history[-MAX_HISTORY:]


class SessionStore:
    """Conversation context lives in memory for the current AI session only (no persistence)."""

    def __init__(self) -> None:
        self._s: OrderedDict[str, Session] = OrderedDict()

    def get(self, sid: str) -> Session:
        now = time.monotonic()
        for k in [k for k, v in self._s.items() if now - v.touched > SESSION_TTL]:
            self._s.pop(k, None)
        sess = self._s.get(sid)
        if sess is None:
            sess = self._s[sid] = Session()
            while len(self._s) > MAX_SESSIONS:
                self._s.popitem(last=False)
        sess.touched = now
        self._s.move_to_end(sid)
        return sess

    def clear(self, sid: str) -> None:
        self._s.pop(sid, None)


limiter = RateLimiter(get_settings().ai_rate_limit_per_min)
deduper = Deduper()
sessions = SessionStore()
