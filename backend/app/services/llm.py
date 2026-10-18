"""LLMService: Gemini through the official `google-genai` SDK, structured JSON output, safe failure."""
import asyncio
import logging
import re
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.core.config import get_settings

log = logging.getLogger("llm")
T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(Exception):
    """Gemini cannot be used right now. `reason` is safe to show; it never contains secrets."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason  # not_configured | timeout | rate_limited | auth | upstream | no_model


class LLMInvalidOutput(Exception):
    pass


_FLASH = re.compile(r"^models/gemini-(\d+(?:\.\d+)?)-flash$")


class LLMService:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.gemini_api_key or None
        self._configured_model = s.gemini_model or None
        self._model: str | None = self._configured_model
        self._timeout = s.gemini_timeout_s
        self._sem = asyncio.Semaphore(s.gemini_max_concurrency)
        self._thinking_budget = s.gemini_thinking_budget
        self._client = None

    @property
    def configured(self) -> bool:
        return self._key is not None

    @property
    def model(self) -> str | None:
        return self._model

    def _get_client(self):
        if not self._key:
            raise LLMUnavailable("not_configured")
        if self._client is None:
            from google import genai
            from google.genai import types

            self._client = genai.Client(
                api_key=self._key, http_options=types.HttpOptions(timeout=int(self._timeout * 1000))
            )
        return self._client

    async def resolve_model(self) -> str:
        """Configured model, else the newest `gemini-<version>-flash` that supports generateContent."""
        if self._model:
            return self._model
        client = self._get_client()
        best: tuple[float, str] | None = None
        try:
            pager = await asyncio.wait_for(client.aio.models.list(), self._timeout)
            async for m in pager:
                match = _FLASH.match(m.name or "")
                if match and "generateContent" in (m.supported_actions or []):
                    v = float(match.group(1))
                    if best is None or v > best[0]:
                        best = (v, m.name.removeprefix("models/"))
        except Exception as exc:
            raise self._map_error(exc) from None
        if best is None:
            raise LLMUnavailable("no_model")
        self._model = best[1]
        log.info("selected Gemini model %s", self._model)
        return self._model

    @staticmethod
    def _map_error(exc: Exception) -> LLMUnavailable:
        if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
            return LLMUnavailable("timeout")
        code = getattr(exc, "code", None)
        if code == 404:  # model retired / not available for this key (e.g. gemini-2.5-flash for new users)
            return LLMUnavailable("no_model")
        if code == 429:
            return LLMUnavailable("rate_limited")
        if code in (400, 401, 403):
            return LLMUnavailable("auth")
        name = type(exc).__name__
        if "Timeout" in name:
            return LLMUnavailable("timeout")
        return LLMUnavailable("upstream")

    async def generate(
        self, *, system: str, prompt: str, schema: type[T], max_output_tokens: int = 1500, temperature: float = 0.3
    ) -> T:
        """One structured generation. Retries once on 429/5xx. Raises LLMUnavailable / LLMInvalidOutput."""
        from google.genai import types

        model = await self.resolve_model()
        client = self._get_client()
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            # current flash models "think" by default; those tokens count against max_output_tokens and can cut the
            # JSON short. Structured extraction/explanations do not need it (every answer is validated anyway).
            thinking_config=types.ThinkingConfig(thinking_budget=self._thinking_budget),
        )
        last: LLMUnavailable | None = None
        async with self._sem:
            for attempt in (1, 2):
                try:
                    resp = await asyncio.wait_for(
                        client.aio.models.generate_content(model=model, contents=prompt, config=config),
                        self._timeout + 5,
                    )
                    break
                except Exception as exc:
                    last = self._map_error(exc)
                    # log the class and HTTP code only: messages can echo request content
                    log.warning("gemini call failed: %s code=%s", type(exc).__name__, getattr(exc, "code", None))
                    if last.reason in ("auth",) or attempt == 2:
                        raise last from None
                    await asyncio.sleep(1.5)
            else:  # pragma: no cover
                raise last or LLMUnavailable("upstream")

        parsed = getattr(resp, "parsed", None)
        if isinstance(parsed, schema):
            return parsed
        try:
            return schema.model_validate_json(resp.text or "")
        except (ValidationError, ValueError):
            raise LLMInvalidOutput("model returned invalid structured output") from None


_llm: LLMService | None = None


def get_llm() -> LLMService:
    global _llm
    if _llm is None:
        _llm = LLMService()
    return _llm
