import { Accessibility, Baby, Clock, Coffee, Footprints, LayoutGrid, LocateFixed, Loader2, SlidersHorizontal, Smile, Utensils, Wallet, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MOOD_ICONS } from "@/components/icons";
import { useLocate } from "@/hooks/useLocate";
import { cn } from "@/lib/utils";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useMapUi } from "@/stores/mapui";
import { personalizationOn, useProfile } from "@/stores/profile";

/** Everyday intents (stage 7): one tap shows real places of these categories on the map and in "Places for you". */
export const INTENTS = {
  eat: { icon: Utensils, categories: ["restaurant", "cafe"] },
  coffee: { icon: Coffee, categories: ["cafe"] },
  walk: { icon: Footprints, categories: ["park", "promenade", "public_space", "attraction", "monument", "architecture", "viewpoint"] },
  kids: { icon: Baby, categories: ["playground", "park", "attraction", "museum"] },
} as const;
type IntentKey = keyof typeof INTENTS;
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium shadow-sm transition active:scale-95",
        on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Quick filters next to the search field. Each chip shows its current value ("Спокойно", "60 мин", "Бесплатно")
 * and every value goes to the real backend: the recommendation layer (`/api/ai/search`), the regular POI layer
 * (categories) and the AI guide all read the same walk context.
 */
export function FilterChips() {
  const { t } = useTranslation();
  const c = useWalkContext();
  const ex = useExplore();
  const ui = useMapUi();
  const prof = useProfile();
  const loc = useLocate();
  const MoodIcon = c.mood ? MOOD_ICONS[c.mood] : Smile;
  const extra = [!c.useWeather, !c.recLayer, !personalizationOn(prof) && prof.personalize === false].filter(Boolean).length;
  const firstCat = ex.categories[0];

  const activeIntent = (Object.keys(INTENTS) as IntentKey[]).find((k) => same(ex.categories, INTENTS[k].categories)) ?? null;
  const toggleIntent = (k: IntentKey) => {
    const on = activeIntent === k;
    ex.setCategories(on ? [] : [...INTENTS[k].categories]);
    if (k === "kids") c.setWithChildren(!on);
    ui.setListMode("for_you");
    if (ui.panel === "results" && ui.sheet === "collapsed") ui.setSheet("half");
  };

  return (
    <div className="scroll-hide -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 md:mx-0 md:flex-wrap md:px-0">
      {(Object.keys(INTENTS) as IntentKey[]).map((k) => {
        const Icon = INTENTS[k].icon;
        return (
          <Chip key={k} on={activeIntent === k} onClick={() => toggleIntent(k)}>
            <Icon className="h-4 w-4" /> {t(`filters.intent.${k}`)}
          </Chip>
        );
      })}
      <Chip on={prof.prefs.wheelchair} onClick={() => prof.setPrefs({ wheelchair: !prof.prefs.wheelchair })} label={t("filters.wheelchair")}>
        <Accessibility className="h-4 w-4" /> {t("filters.intent.accessible")}
      </Chip>
      <Chip on={!!c.mood} onClick={() => ui.setPicker("mood")}>
        <MoodIcon className="h-4 w-4" /> {c.mood ? t(`moodShort.${c.mood}`) : t("filters.mood")}
      </Chip>
      <Chip
        on={!!ex.origin}
        onClick={async () => {
          if (ex.origin) return ui.setPicker("near");
          const ok = await loc.locate();
          if (!ok) ui.setPicker("near"); // denied / unavailable: explain and offer a point on the map
        }}
      >
        {loc.state === "locating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
        {ex.origin ? t(ex.origin.source === "geolocation" ? "filters.nearValue" : "filters.pointValue", { km: ex.radiusKm }) : t("filters.near")}
      </Chip>
      <Chip on={!!c.timeMinutes} onClick={() => ui.setPicker("time")}>
        <Clock className="h-4 w-4" /> {c.timeMinutes ? t("filters.timeValue", { n: c.timeMinutes }) : t("filters.time")}
      </Chip>
      <Chip on={!!c.budget} onClick={() => ui.setPicker("budget")}>
        <Wallet className="h-4 w-4" /> {c.budget ? t(`filters.budgetValue.${c.budget}`) : t("filters.budget")}
      </Chip>
      <Chip on={ex.categories.length > 0 && !activeIntent} onClick={() => ui.setPicker("categories")}>
        <LayoutGrid className="h-4 w-4" />
        {firstCat ? `${t(`categories.${firstCat}`)}${ex.categories.length > 1 ? ` +${ex.categories.length - 1}` : ""}` : t("filters.categories")}
      </Chip>
      <Chip on={extra > 0} onClick={() => ui.setPicker("filters")}>
        <SlidersHorizontal className="h-4 w-4" /> {t("filters.more")}
        {extra > 0 && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[11px]">{extra}</span>}
      </Chip>
      {(c.aiWishes.interests.length > 0 || c.aiWishes.exclude_categories.length > 0) && (
        <span className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 bg-accent px-3 text-[13px] font-medium text-accent-foreground">
          {t("filters.aiWishes", {
            list: [
              ...c.aiWishes.interests.map((i) => t(`interest.${i}`, { defaultValue: i })),
              ...c.aiWishes.exclude_categories.map((x) => t("filters.without", { what: t(`categories.${x}`) })),
            ].join(", "),
          })}
          <button type="button" onClick={c.clearAiWishes} aria-label={t("common.clear")}>
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}
