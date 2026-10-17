from pydantic import BaseModel


class DatabaseStatus(BaseModel):
    connected: bool
    version: str | None = None
    postgis: str | None = None
    pgvector: str | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    status: str  # "ok" | "degraded"
    app: str
    version: str
    environment: str
    database: DatabaseStatus
