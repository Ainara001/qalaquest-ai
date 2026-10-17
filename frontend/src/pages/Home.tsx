import { ChevronRight, MapPin, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { getPosition } from "@/services/geo";
import { fetchPois, type PoiItem } from "@/services/pois";
import type { AiParams } from "@/services/ai";
import { useExplore } from "@/stores/explore";
import { useGuide } from "@/stores/guide";
import { cn } from "@/lib/utils";

const QUICK: { key: "nearby" | "min30" | "free" | "kids" | "unusual" | "quiet"; params?: AiParams }[] = [
  { key: "nearby" },
  { key: "min30", params: { time_minutes: 30 } },
  { key: "free", params: { free_only: true } },
  { key: "kids", params: { with_children: true } },
  { key: "unusual" },
  { key: "quiet" },
];

const FEATURED = ["attraction", "museum", "park", "monument", "viewpoint", "architecture", "theatre"];

function greetingKey(): string {
  const h = new Date().getHours();
  return h < 5 ? "greetingNight" : h < 12 ? "greetingMorning" : h < 18 ? "greetingDay" : "greetingEvening";
}

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const origin = useExplore((s) => s.origin);
  const setOrigin = useExplore((s) => s.setOrigin);
  const anchor = useGuide((g) => g.anchor);
  const send = useGuide((g) => g.send);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [places, setPlaces] = useState<{ items: PoiItem[]; total: number } | null>(null);
  const [placesError, setPlacesError] = useState(false);

  useEffect(() => {
    const q = { categories: FEATURED, search: "", origin: origin ? { lat: origin.lat, lon: origin.lon } : null, radiusKm: 5 };
    const ctrl = new AbortController();
    fetchPois(q, document.documentElement.lang || "ru", 0, 8, ctrl.signal)
      .then((r) => setPlaces({ items: r.items, total: r.total }))
      .catch((e) => e?.name !== "AbortError" && setPlacesError(true));
    return () => ctrl.abort();
  }, [origin?.lat, origin?.lon, t]);

  const startLabel = anchor?.name
    ? t("home.startPlace", { name: anchor.name })
    : origin
      ? origin.source === "geolocation" ? t("home.startGeo") : t("home.startManual")
      : null;

  const ask = (message: string, params?: AiParams) => {
    navigate("/guide");
    void send(message, params);
  };

  const quick = async (k: (typeof QUICK)[number]) => {
    setBusy(k.key);
    if (k.key === "nearby" && !useExplore.getState().origin) {
      try {
        const p = await getPosition();
        setOrigin({ lat: p.lat, lon: p.lon, source: "geolocation" });
      } catch {
        /* denied: the guide will tell the user which start point it assumed */
      }
    }
    setBusy(null);
    ask(t(`quick.${k.key}.message`), k.params);
  };

  return (
    <div className="space-y-7 md:space-y-10">
      <section className="space-y-1">
        <p className="text-sm text-muted-foreground">{t(`home.${greetingKey()}`)}</p>
        <Link to="/map" className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm">
          <MapPin className="h-4 w-4 text-[hsl(var(--brand))]" />
          <span className="font-medium">{startLabel ? t("home.startPoint", { label: startLabel }) : t("home.noStart")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </section>

      <section className="rounded-3xl border bg-card p-5 shadow-sm md:p-8">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight md:text-5xl">{t("home.aiTitle")}</h1>
        <p className="mt-2 max-w-xl text-[15px] text-muted-foreground md:text-lg">{t("home.aiSubtitle")}</p>
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) ask(text.trim());
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={t("home.aiPlaceholder")}
            aria-label={t("home.aiLabel")}
            className="w-full resize-none rounded-2xl border bg-background p-4 leading-snug outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-sm transition active:scale-[0.99] disabled:opacity-50 md:w-auto md:px-8"
          >
            <Sparkles className="h-5 w-5" /> {t("home.aiButton")}
          </button>
        </form>
        <div className="mt-5">
          <h2 className="sr-only">{t("home.quickTitle")}</h2>
          <div className="-mx-1 flex flex-wrap gap-2">
            {QUICK.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => quick(k)}
                disabled={busy !== null}
                className={cn(
                  "rounded-full border bg-background px-4 py-2 text-sm font-medium transition active:bg-muted disabled:opacity-60",
                  busy === k.key && "animate-pulse",
                )}
              >
                {t(`quick.${k.key}.label`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold">{t("home.placesTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("home.placesSubtitle")}</p>
          </div>
          <Link to="/map" className="text-sm font-medium text-primary">
            {t("home.placesAll")}
          </Link>
        </div>
        {placesError ? (
          <p className="text-sm text-muted-foreground">{t("home.placesError")}</p>
        ) : !places ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : places.items.length === 0 ? (
          <div className="rounded-2xl border bg-card p-5">
            <p className="font-medium">{t("home.placesEmpty")}</p>
            <p className="text-sm text-muted-foreground">{t("home.placesEmptyHint")}</p>
          </div>
        ) : (
          <div className="scroll-hide -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {places.items.map((p) => (
              <Link
                key={p.id}
                to="/map"
                onClick={() => useExplore.getState().select(p.id)}
                className="w-[70%] shrink-0 snap-start rounded-2xl border bg-card p-4 shadow-sm active:bg-muted sm:w-auto"
              >
                <p className="line-clamp-2 font-semibold leading-snug">{p.name ?? t("explore.unnamed")}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CategoryDot category={p.category} /> {t(`categorySingular.${p.category}`)}
                </p>
                {p.address && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{p.address}</p>}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
