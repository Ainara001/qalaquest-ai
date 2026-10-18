import { CloudSun, RefreshCw, Wind } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getWeather, type WeatherReport } from "@/services/routes";

/** Compact real-weather block (Open-Meteo through the backend). Never shows invented values. */
export function WeatherCard({ lat, lon, minutes = 90, compact = false }: { lat?: number; lon?: number; minutes?: number; compact?: boolean }) {
  const { t } = useTranslation();
  const [w, setW] = useState<WeatherReport | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    getWeather(lat, lon, minutes).then(setW).catch(() => setFailed(true));
  }, [lat, lon, minutes]);
  useEffect(load, [load]);

  if (failed)
    return (
      <div className="flex items-center justify-between gap-2 rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        {t("weather.unavailable")}
        <button type="button" onClick={load} aria-label={t("common.retry")} className="rounded-full p-1.5 hover:bg-muted"><RefreshCw className="h-4 w-4" /></button>
      </div>
    );
  if (!w) return <div className="h-20 animate-pulse rounded-2xl bg-muted" />;

  const c = w.current;
  const a = w.assessment;
  const conds = a.conditions.filter((x) => x !== "comfortable").map((x) => t(`weather.conditions.${x}`)).join(", ");
  const time = c.time_local.slice(11, 16);
  return (
    <div className={cn("rounded-2xl border bg-card p-4 shadow-sm", a.level !== "comfortable" && "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CloudSun className="h-8 w-8 shrink-0 text-[hsl(var(--brand))]" />
          <div>
            <p className="text-2xl font-bold leading-none">{c.temperature_c !== null ? `${Math.round(c.temperature_c)}°` : "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`weather.summary.${c.summary}`)}
              {c.apparent_c !== null && <> · {t("weather.feels", { t: Math.round(c.apparent_c) })}</>}
            </p>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {c.wind_ms !== null && <p className="flex items-center justify-end gap-1"><Wind className="h-3.5 w-3.5" /> {t("weather.wind", { v: c.wind_ms.toFixed(1) })}</p>}
          {c.gusts_ms !== null && <p>{t("weather.gusts", { v: c.gusts_ms.toFixed(0) })}</p>}
          {a.max_precipitation_probability_pct !== null && <p>{t("weather.precip", { p: Math.round(a.max_precipitation_probability_pct) })}</p>}
        </div>
      </div>
      {!compact && (
        <p className="mt-3 text-sm">{t(`weather.advice.${a.level}`, { conds })}</p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("weather.updated", { time })} · Open-Meteo{w.stale && <> · {t("weather.stale")}</>}
        {a.level !== "comfortable" && <> · {t("weather.disclaimer")}</>}
      </p>
    </div>
  );
}
