import { ChevronDown, Footprints, Loader2, MapPin, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { INTEREST_ICONS, MOOD_ICONS } from "@/components/icons";
import { Notices, Totals } from "@/components/walk/WalkParts";
import { formatDistance } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GroupMemberInput } from "@/services/advanced";
import { MOODS, TIME_OPTIONS } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { MAX_MEMBERS, useGroup } from "@/stores/group";
import { useMapUi } from "@/stores/mapui";
import { PROFILE_INTERESTS } from "@/stores/profile";
import { useWalk } from "@/stores/walk";

type T = (k: string, o?: Record<string, unknown>) => string;
const BUDGETS = ["free", "2000", "5000", "10000"] as const;
const PACES = ["slow", "normal", "active"] as const;

const label = (m: GroupMemberInput, i: number, t: T) => m.name.trim() || t("group.member", { n: i + 1 });

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>
      {children}
    </button>
  );
}

function MemberCard({ i, open, onToggle }: { i: number; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const g = useGroup();
  const m = g.members[i];
  const set = (patch: Partial<GroupMemberInput>) => g.update(i, patch);
  const summary = [
    ...m.interests.slice(0, 3).map((x) => t(`interest.${x}`)),
    m.interests.length > 3 ? `+${m.interests.length - 3}` : null,
    m.mood ? t(`moodShort.${m.mood}`) : null,
    m.time_minutes ? t("filters.timeValue", { n: m.time_minutes }) : null,
  ].filter(Boolean).join(" · ");
  return (
    <li className="rounded-2xl border bg-background">
      <div className="flex items-center gap-2 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{i + 1}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-semibold">{label(m, i, t)}</span>
          <span className="block truncate text-xs text-muted-foreground">{summary || t("group.noPrefs")}</span>
        </button>
        <button type="button" onClick={onToggle} aria-label={t("group.edit")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
          {open ? <ChevronDown className="h-4 w-4 rotate-180" /> : <Pencil className="h-4 w-4" />}
        </button>
        {g.members.length > 2 && (
          <button type="button" onClick={() => g.remove(i)} aria-label={t("group.remove")} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-3 border-t p-3">
          <input value={m.name} maxLength={30} onChange={(e) => set({ name: e.target.value })} placeholder={t("group.namePlaceholder", { n: i + 1 })} aria-label={t("group.name")} className="h-10 w-full rounded-xl border bg-card px-3 outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("group.interests")}</p>
            <div className="flex flex-wrap gap-1.5">
              {PROFILE_INTERESTS.map((x) => {
                const Icon = INTEREST_ICONS[x];
                const on = m.interests.includes(x);
                return (
                  <Pill key={x} on={on} onClick={() => set({ interests: on ? m.interests.filter((y) => y !== x) : m.interests.length < 8 ? [...m.interests, x] : m.interests })}>
                    <Icon className="h-3.5 w-3.5" /> {t(`interest.${x}`)}
                  </Pill>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("mood.title")}</p>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((x) => {
                const Icon = MOOD_ICONS[x];
                return <Pill key={x} on={m.mood === x} onClick={() => set({ mood: m.mood === x ? null : x })}><Icon className="h-3.5 w-3.5" /> {t(`moodShort.${x}`)}</Pill>;
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("filters.time")}</p>
            <div className="flex flex-wrap gap-1.5">
              {TIME_OPTIONS.map((x) => <Pill key={x} on={m.time_minutes === x} onClick={() => set({ time_minutes: m.time_minutes === x ? null : x })}>{t("filters.timeValue", { n: x })}</Pill>)}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("filters.budget")}</p>
            <div className="flex flex-wrap gap-1.5">
              {BUDGETS.map((x) => <Pill key={x} on={m.budget === x} onClick={() => set({ budget: m.budget === x ? null : x })}>{t(`filters.budgetValue.${x}`)}</Pill>)}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("group.pace")}</p>
            <div className="flex flex-wrap gap-1.5">
              {PACES.map((x) => <Pill key={x} on={m.pace === x} onClick={() => set({ pace: m.pace === x ? null : x })}>{t(`profile.pace${x[0].toUpperCase()}${x.slice(1)}`)}</Pill>)}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Pill on={m.wheelchair} onClick={() => set({ wheelchair: !m.wheelchair })}>{t("filters.wheelchair")}</Pill>
            <Pill on={m.with_children} onClick={() => set({ with_children: !m.with_children })}>{t("filters.withChildren")}</Pill>
          </div>
        </div>
      )}
    </li>
  );
}

export function GroupHeader() {
  const { t } = useTranslation();
  const ui = useMapUi();
  const g = useGroup();
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-bold leading-tight">
        <Users className="h-5 w-5 text-[hsl(var(--brand))]" /> {t("group.title")}
        {g.status === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </h2>
      <button type="button" onClick={() => ui.open("results", "collapsed")} aria-label={t("common.close")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function compromiseText(code: string, p: Record<string, string | number>, t: T, names: Record<number, string>): string {
  if (code === "group_shared_place") return t("group.notes.group_shared_place", { place: names[Number(p.poi_id)] ?? "", count: p.count, total: p.total });
  if (code === "group_member_not_covered") {
    const ints = String(p.interests || "").split(",").filter(Boolean).map((x) => t(`interest.${x}`).toLowerCase()).join(", ");
    return t("group.notes.group_member_not_covered", { member: String(p.member).startsWith("#") ? t("group.member", { n: String(p.member).slice(1) }) : p.member, interests: ints || "—" });
  }
  if (code === "group_pace_slowest") return t("group.notes.group_pace_slowest", { pace: t(`profile.pace${String(p.pace)[0].toUpperCase()}${String(p.pace).slice(1)}`) });
  if (code === "group_budget_strictest") return t("group.notes.group_budget_strictest", { budget: t(`filters.budgetValue.${p.budget}`, { defaultValue: String(p.budget) }) });
  return t(`group.notes.${code}`, p);
}

/** Group Harmony: participants as compact cards → one walk with an explained compromise. */
export function GroupPanel() {
  const { t } = useTranslation();
  const g = useGroup();
  const ui = useMapUi();
  const walk = useWalk();
  const select = useExplore((e) => e.select);
  const [open, setOpen] = useState<number | null>(0);
  const r = g.result;

  if (r) {
    const names = Object.fromEntries(r.places.map((p) => [p.place.poi_id, p.place.name ?? t(`categorySingular.${p.place.category}`)]));
    const memberName = (k: number) => label(g.members[k] ?? { name: "" } as GroupMemberInput, k, t);
    return (
      <div className="space-y-3">
        {r.status === "no_results" ? (
          <div className="rounded-2xl border bg-background p-4 text-sm">
            <p className="font-medium">{t("group.none")}</p>
            {r.notices.length > 0 && <p className="mt-1 text-muted-foreground">{r.notices.map((n) => t(`walk.notices.${n.code}`, { ...n.params, defaultValue: "" })).filter(Boolean).join(" ")}</p>}
          </div>
        ) : (
          <>
            {r.route && <Totals route={r.route} />}
            <section>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("group.whyTitle")}</p>
              <ul className="space-y-1">
                {r.compromise.map((n, i) => <li key={i} className="rounded-xl bg-accent/60 px-3 py-2 text-[13px]">{compromiseText(n.code, n.params, t, names)}</li>)}
              </ul>
            </section>
            <ol className="space-y-2">
              {r.places.map((p, i) => (
                <li key={p.place.poi_id}>
                  <button type="button" onClick={() => select(p.place.poi_id)} className="flex w-full items-start gap-3 rounded-2xl border bg-background p-3 text-left">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{p.place.name ?? t("explore.unnamed")}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5"><CategoryDot category={p.place.category} /> {t(`categorySingular.${p.place.category}`)}</span>
                        {p.place.distance_m !== null && <span>· {formatDistance(p.place.distance_m, t)}</span>}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {p.members.length ? p.members.map((k) => <span key={k} className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">{memberName(k)}</span>)
                          : <span className="text-[11px] text-muted-foreground">{t("group.forRoute")}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <section>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("group.membersTitle")}</p>
              <ul className="space-y-1.5">
                {r.members.map((m) => (
                  <li key={m.index} className="flex items-center gap-2 text-[13px]">
                    <span className="w-24 shrink-0 truncate font-medium">{memberName(m.index)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", m.level === "low" ? "bg-amber-500" : "bg-[hsl(var(--brand))]")} style={{ width: `${Math.round(m.satisfaction * 100)}%` }} /></span>
                    <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{t(`group.level.${m.level}`)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t("group.fitHint")}</p>
            </section>
            {r.route && <Notices route={{ ...r.route, notices: [...r.route.notices, ...r.notices] }} />}
            {r.route && r.route.stops.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  walk.setDraft(r.route!, r.route!.start, r.common.time_minutes ?? r.route!.totals?.total_minutes ?? 120);
                  ui.open("route", "half");
                }}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
              >
                <Footprints className="h-4 w-4" /> {t("group.toRoute")}
              </button>
            )}
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { useExplore.getState().focusAiPicks(); ui.setSheet("collapsed"); }} className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border text-sm font-semibold">
            <MapPin className="h-4 w-4" /> {t("surprise.showOnMap")}
          </button>
          <button type="button" onClick={g.clearResult} className="h-11 rounded-2xl border text-sm font-semibold">{t("group.editMembers")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("group.intro")}</p>
      <ul className="space-y-2">
        {g.members.map((_, i) => <MemberCard key={i} i={i} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />)}
      </ul>
      {g.members.length < MAX_MEMBERS && (
        <button type="button" onClick={() => { g.add(); setOpen(g.members.length); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed text-sm font-semibold">
          <Plus className="h-4 w-4" /> {t("group.add")}
        </button>
      )}
      {g.status === "error" && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t(`guide.errors.${g.errorCode}`, { defaultValue: t("guide.errors.generic") })}</p>}
      <button type="button" disabled={g.status === "loading"} onClick={() => void g.recommend()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50">
        {g.status === "loading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Users className="h-5 w-5" />} {t("group.find")}
      </button>
      <p className="text-[11px] text-muted-foreground">{t("group.privacy")}</p>
    </div>
  );
}
