from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "QalaQuest AI"
    app_version: str = "0.1.0"
    app_env: str = "development"
    log_level: str = "INFO"

    database_url: str
    cors_origins: str = "http://localhost:5173"

    # --- AI / RAG ---
    gemini_api_key: str | None = None
    # Empty = discover the newest available Gemini "flash" model through the API at runtime.
    gemini_model: str | None = None
    gemini_timeout_s: float = 30.0
    gemini_max_concurrency: int = 3
    gemini_thinking_budget: int = 0  # 0 = no "thinking" tokens for structured output (faster, no truncated JSON)
    ai_rate_limit_per_min: int = 12  # per client IP, across /api/ai/*
    embedding_model: str = "intfloat/multilingual-e5-large"
    embedding_dim: int = 1024
    embedding_cache_dir: str | None = None
    ranking_weights: str | None = None  # JSON override of app.core.ranking.DEFAULT_WEIGHTS

    # --- routing / weather (stage 5) ---
    valhalla_url: str = "http://localhost:8002"
    valhalla_timeout_s: float = 15.0
    weather_url: str = "https://api.open-meteo.com/v1/forecast"
    weather_timeout_s: float = 8.0
    weather_cache_s: int = 600
    weather_rules: str | None = None  # JSON override of app.core.weather_rules.DEFAULT_RULES

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
