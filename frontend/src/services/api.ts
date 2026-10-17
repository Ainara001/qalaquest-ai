const BASE_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(0, "Backend is unreachable");
  }
  const body = await res.json().catch(() => null);
  // /api/health returns a meaningful body with 503, so hand it to the caller.
  if (!res.ok && !(body && "status" in body)) {
    throw new ApiError(res.status, body?.error?.message ?? res.statusText);
  }
  return body as T;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  app: string;
  version: string;
  environment: string;
  database: {
    connected: boolean;
    version: string | null;
    postgis: string | null;
    pgvector: string | null;
    error: string | null;
  };
}

export const getHealth = () => api<HealthResponse>("/api/health");
