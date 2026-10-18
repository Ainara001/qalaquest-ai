import { Accessibility, Ban, Bookmark, CheckCircle2, Footprints, Heart, Info, MapPin, Moon, ShieldCheck, Sparkles, Sun, Trash2, Wallet, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { INTEREST_ICONS } from "@/components/icons";
import { LANGUAGES } from "@/i18n";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fetchStats, type PoiStats } from "@/services/pois";
import { useExplore } from "@/stores/explore";
import { useGuide } from "@/stores/guide";
import { isConfigured, personalizationOn, PROFILE_INTERESTS, useProfile, type Budget, type FeedbackKind, type Pace, type Setting } from "@/stores/profile";
import { useTheme } from "@/stores/theme";

/** What the app knows: number of real places and the date of the OpenStreetMap snapshot (was on the old Home). */
function DataInfo() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<PoiStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetchStats().then(setStats).catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="mt-2 text-sm text-muted-foreground">{t("profile.dataError")}</p>;
  if (!stats) return <p className="mt-2 h-5 w-48 animate-pulse rounded bg-muted" />;
  if (!stats.total) return <p className="mt-2 text-sm text-muted-foreground">{t("profile.dataEmpty")}</p>;
  const when = stats.osm_data_timestamp ?? stats.last_successful_update;
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {t("profile.dataTotal", { count: stats.total })}
      {when && <> · {t("profile.dataUpdated", { date: formatDate(when, i18n.language) })}</>}
      <span className="block text-xs">{t("poi.attribution")}</span>
    </p>
  );
}

function Section({ icon, title, children, hint }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="text-[hsl(var(--brand))]">{icon}</span> {title}
      </h2>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-medium leading-tight transition", value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-3 py-1 text-left">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className={cn("relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition", checked ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", checked ? "left-[1.375rem]" : "left-0.5")} />
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** A destructive button that asks for a second tap instead of a modal. */
function ConfirmButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<"idle" | "confirm" | "done">("idle");
  return (
    <button
      type="button"
      onClick={() => {
        if (stage === "confirm") {
          onConfirm();
          setStage("done");
        } else setStage("confirm");
      }}
      onBlur={() => stage === "confirm" && setStage("idle")}
      className={cn("flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition", stage === "confirm" ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200" : "active:bg-muted")}
    >
      <Trash2 className="h-4 w-4" /> {stage === "confirm" ? t("profile.confirm") : stage === "done" ? t("profile.done") : label}
    </button>
  );
}

const CATEGORY_KEYS = Object.keys(CATEGORY_COLORS);

export function Profile() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { theme, set: setTheme } = useTheme();
  const guide = useGuide();
  const prof = useProfile();
  const { prefs, setPrefs } = prof;
  const [bannerHidden, setBannerHidden] = useState(false);
  const on = personalizationOn(prof);
  const feedbackCount = Object.values(prof.feedback).reduce((n, l) => n + l.length, 0);

  const openOnMap = (id: number) => {
    useExplore.getState().select(id);
    navigate("/");
  };

  const placeList = (kind: FeedbackKind, empty: string, action: "remove" | "restore") => {
    const ids = prof.feedback[kind];
    if (!ids.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
    return (
      <ul className="divide-y">
        {ids.map((id) => {
          const ref = prof.places[id];
          return (
            <li key={id} className="flex items-center gap-2 py-2">
              <button type="button" onClick={() => openOnMap(id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {ref && <CategoryDot category={ref.category} />}
                <span className="truncate text-sm">{ref?.name ?? (ref ? t(`categorySingular.${ref.category}`) : `#${id}`)}</span>
              </button>
              <button type="button" onClick={() => openOnMap(id)} className="rounded-full px-2.5 py-1.5 text-xs text-primary">{t("profile.showOnMap")}</button>
              <button
                type="button"
                onClick={() => prof.toggleFeedback(id, kind, ref ?? { name: null, category: "attraction" })}
                aria-label={t(`profile.${action}`)}
                className="rounded-full p-2 text-muted-foreground hover:bg-muted"
              >
                {action === "restore" ? <span className="text-xs font-medium text-primary">{t("profile.restore")}</span> : <X className="h-4 w-4" />}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("profile.subtitle")}</p>
      </div>

      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <Switch checked={on} onChange={prof.setPersonalize} label={t("profile.personalizeTitle")} hint={t("profile.personalizeHint")} />
      </section>

      <Section icon={<Sparkles className="h-5 w-5" />} title={t("profile.interests")} hint={t("profile.interestsHint")}>
        <div className="flex flex-wrap gap-2">
          {PROFILE_INTERESTS.map((i) => {
            const Icon = INTEREST_ICONS[i];
            const sel = prefs.interests.includes(i);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={sel}
                onClick={() => prof.toggleInterest(i)}
                className={cn("flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition active:scale-95", sel ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
              >
                <Icon className="h-4 w-4" /> {t(`interest.${i}`)}
              </button>
            );
          })}
        </div>
      </Section>

      <Section icon={<Footprints className="h-5 w-5" />} title={t("profile.walkTitle")}>
        <div className="space-y-4">
          <Field label={t("profile.duration")}>
            <Segmented
              label={t("profile.duration")}
              value={String(prefs.walk_duration_min ?? "any")}
              onChange={(v) => setPrefs({ walk_duration_min: v === "any" ? null : Number(v) })}
              options={[...["30", "60", "90", "120"].map((v) => ({ value: v, label: t("profile.minutes", { n: v }) })), { value: "any", label: t("profile.durationAny") }]}
            />
          </Field>
          <Field label={t("profile.maxWalk")}>
            <Segmented
              label={t("profile.maxWalk")}
              value={String(prefs.max_walk_m ?? "any")}
              onChange={(v) => setPrefs({ max_walk_m: v === "any" ? null : Number(v) })}
              options={[
                { value: "500", label: t("profile.m", { n: 500 }) },
                { value: "1000", label: t("profile.km", { n: 1 }) },
                { value: "2000", label: t("profile.km", { n: 2 }) },
                { value: "5000", label: t("profile.km", { n: 5 }) },
                { value: "any", label: t("profile.distanceAny") },
              ]}
            />
          </Field>
          <Field label={t("profile.pace")}>
            <Segmented<Pace>
              label={t("profile.pace")}
              value={prefs.pace}
              onChange={(pace) => setPrefs({ pace })}
              options={[{ value: "slow", label: t("profile.paceSlow") }, { value: "normal", label: t("profile.paceNormal") }, { value: "active", label: t("profile.paceActive") }]}
            />
          </Field>
          <Field label={t("profile.setting")}>
            <Segmented<Setting>
              label={t("profile.setting")}
              value={prefs.setting}
              onChange={(setting) => setPrefs({ setting })}
              options={[{ value: "outdoor", label: t("profile.settingOutdoor") }, { value: "indoor", label: t("profile.settingIndoor") }, { value: "any", label: t("profile.settingAny") }]}
            />
          </Field>
          <Field label={t("profile.placesCount")}>
            <Segmented
              label={t("profile.placesCount")}
              value={String(prefs.places_count)}
              onChange={(v) => setPrefs({ places_count: Number(v) as 1 | 2 | 3 })}
              options={["1", "2", "3"].map((v) => ({ value: v, label: v }))}
            />
          </Field>
        </div>
      </Section>

      <Section icon={<Wallet className="h-5 w-5" />} title={t("profile.budget")} hint={t("profile.budgetHint")}>
        <div className="flex flex-wrap gap-2">
          {(["free", "2000", "5000", "10000", "any"] as Budget[]).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={prefs.budget === b}
              onClick={() => setPrefs({ budget: b })}
              className={cn("h-10 rounded-full border px-3.5 text-sm font-medium", prefs.budget === b ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
            >
              {t(`profile.budget${b === "free" ? "Free" : b === "any" ? "Any" : b}`)}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<Accessibility className="h-5 w-5" />} title={t("profile.accessibility")}>
        <div className="space-y-3">
          <Switch checked={prefs.wheelchair} onChange={(wheelchair) => setPrefs({ wheelchair })} label={t("profile.wheelchair")} hint={t("profile.wheelchairHint")} />
          <Switch checked={prefs.with_children} onChange={(with_children) => setPrefs({ with_children })} label={t("profile.children")} />
        </div>
      </Section>

      <Section icon={<Heart className="h-5 w-5" />} title={t("profile.categories")} hint={t("profile.categoriesHint")}>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_KEYS.map((c) => {
            const fav = prefs.favorite_categories.includes(c);
            const dis = prefs.disliked_categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => prof.cycleCategory(c)}
                aria-label={`${t(`categories.${c}`)}: ${fav ? t("profile.favorite") : dis ? t("profile.disliked") : "—"}`}
                className={cn(
                  "flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                  fav ? "border-primary bg-accent text-accent-foreground" : dis ? "border-red-200 bg-red-50 text-red-700 line-through dark:bg-red-950 dark:text-red-200" : "bg-background",
                )}
              >
                {fav ? <Heart className="h-3.5 w-3.5 fill-current" /> : dis ? <Ban className="h-3.5 w-3.5" /> : <CategoryDot category={c} />}
                {t(`categories.${c}`)}
              </button>
            );
          })}
        </div>
      </Section>

      <Section icon={<Bookmark className="h-5 w-5" />} title={t("profile.saved")}>{placeList("saved", t("profile.savedEmpty"), "remove")}</Section>
      <Section icon={<CheckCircle2 className="h-5 w-5" />} title={t("profile.visited")}>{placeList("visited", t("profile.visitedEmpty"), "remove")}</Section>
      <Section icon={<Ban className="h-5 w-5" />} title={t("profile.hidden")}>{placeList("never", t("profile.hiddenEmpty"), "restore")}</Section>

      <Section icon={<ShieldCheck className="h-5 w-5" />} title={t("profile.privacy")}>
        <Switch checked={prof.storeOnDevice} onChange={prof.setStoreOnDevice} label={t("profile.storeOnDevice")} hint={t("profile.storeHint")} />
        <p className="mt-3 text-xs text-muted-foreground">{t("profile.feedbackCount", { count: feedbackCount })}</p>
        <div className="mt-3 grid gap-2">
          <ConfirmButton label={t("profile.clearFeedback")} onConfirm={prof.clearFeedback} />
          <ConfirmButton label={t("profile.resetPrefs")} onConfirm={prof.resetPrefs} />
          <ConfirmButton
            label={t("profile.eraseAll")}
            onConfirm={() => {
              prof.eraseAll();
              guide.clear();
            }}
          />
        </div>
      </Section>

      <Section icon={<Info className="h-5 w-5" />} title={t("profile.language")}>
        <Segmented label={t("common.language")} value={i18n.language as "ru" | "kk"} onChange={(v) => i18n.changeLanguage(v)} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
        <p className="mt-2 text-xs text-muted-foreground">{t("profile.languageHint")}</p>
      </Section>

      <Section icon={theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />} title={t("profile.theme")}>
        <Segmented
          label={t("profile.theme")}
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: <><Sun className="h-4 w-4" /> {t("profile.themeLight")}</> },
            { value: "dark", label: <><Moon className="h-4 w-4" /> {t("profile.themeDark")}</> },
          ]}
        />
      </Section>

      <Section icon={<Trash2 className="h-5 w-5" />} title={t("profile.session")} hint={t("profile.sessionHint")}>
        <p className="text-sm font-medium">{t("profile.sessionMessages", { count: guide.messages.length })}</p>
        <button
          type="button"
          disabled={guide.messages.length === 0}
          onClick={guide.clear}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition active:bg-muted disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" /> {t("profile.sessionClear")}
        </button>
      </Section>

      <Section icon={<MapPin className="h-5 w-5" />} title={t("profile.geo")}>
        <p className="text-sm text-muted-foreground">{t("profile.geoText")}</p>
      </Section>

      <Section icon={<Info className="h-5 w-5" />} title={t("profile.about")}>
        <p className="text-sm text-muted-foreground">{t("profile.aboutText", { version: __APP_VERSION__ })}</p>
        <DataInfo />
      </Section>

      {!prof.storeOnDevice && !bannerHidden && (isConfigured(prefs) || feedbackCount > 0) && (
        <div role="status" className="fixed inset-x-3 z-30 mx-auto max-w-xl rounded-2xl border border-primary/30 bg-accent p-4 shadow-lg md:bottom-6" style={{ bottom: "calc(var(--nav-eff) + 0.75rem)" }}>
          <p className="text-sm font-medium text-accent-foreground">{t("profile.storeBanner")}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => prof.setStoreOnDevice(true)} className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">{t("profile.storeBannerYes")}</button>
            <button type="button" onClick={() => setBannerHidden(true)} className="h-10 flex-1 rounded-xl border bg-card text-sm font-medium">{t("profile.storeBannerNo")}</button>
          </div>
        </div>
      )}
      {!prof.storeOnDevice && !bannerHidden && (isConfigured(prefs) || feedbackCount > 0) && <div aria-hidden className="h-28" />}
    </div>
  );
}
