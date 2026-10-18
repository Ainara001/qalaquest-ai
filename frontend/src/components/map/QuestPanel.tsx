import { Baby, Building2, Camera, Check, Compass, Flag, Loader2, MapPin, RefreshCw, ScrollText, SkipForward, Sparkles, Swords, WandSparkles, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Notices } from "@/components/walk/WalkParts";
import { cn } from "@/lib/utils";
import { QUEST_TYPES, type QuestTask, type QuestType } from "@/services/advanced";
import { useExplore } from "@/stores/explore";
import { useMapUi } from "@/stores/mapui";
import { questDone, questFinished, useQuest, type TaskStatus } from "@/stores/quest";

const TYPE_ICON: Record<QuestType, typeof Compass> = {
  explorer: Compass, photo_hunt: Camera, architecture: Building2, history: ScrollText, family: Baby, city_secrets: WandSparkles,
};
const STATUS_STYLE: Record<TaskStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  active: "bg-primary text-primary-foreground",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  skipped: "bg-muted text-muted-foreground line-through",
};

export function taskText(task: QuestTask, t: (k: string, o?: Record<string, unknown>) => string): string {
  return task.text ?? t(`quest.tasks.${task.template}`, { ...task.params, defaultValue: t("quest.tasks.visit_look", task.params) });
}

export function QuestHeader() {
  const { t } = useTranslation();
  const ui = useMapUi();
  const q = useQuest();
  const title = q.quest ? q.quest.title ?? t(`quest.types.${q.quest.type}`) : t("quest.title");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold leading-tight">
          <Swords className="h-5 w-5 shrink-0 text-[hsl(var(--brand))]" /> <span className="truncate">{title}</span>
          {q.status === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </h2>
        <button type="button" onClick={() => ui.open("results", "collapsed")} aria-label={t("common.close")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>
      {q.quest && q.quest.tasks.length > 0 && (
        <div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("quest.progress", { done: questDone(q), total: q.quest.tasks.length })}</span>
            {q.quest.estimated_minutes && <span>{t("quest.time", { n: q.quest.estimated_minutes })}</span>}
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={q.quest.tasks.length} aria-valuenow={questDone(q)}>
            <div className="h-full rounded-full bg-[hsl(var(--brand))] transition-all" style={{ width: `${(questDone(q) / q.quest.tasks.length) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function TypePicker() {
  const { t } = useTranslation();
  const q = useQuest();
  const [type, setType] = useState<QuestType>("explorer");
  const [count, setCount] = useState(3);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("quest.intro")}</p>
      <div className="grid grid-cols-2 gap-2">
        {QUEST_TYPES.map((k) => {
          const Icon = TYPE_ICON[k];
          const on = type === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setType(k)} className={cn("flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-2xl border px-3 py-2 text-left", on ? "border-primary bg-accent" : "bg-background")}>
              <span className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4 text-[hsl(var(--brand))]" /> {t(`quest.types.${k}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`quest.typeHints.${k}`)}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t("quest.tasksCount")}</p>
        <div className="flex gap-2">
          {[2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)} className={cn("h-10 w-12 rounded-full border text-sm font-medium", count === n ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{n}</button>
          ))}
        </div>
      </div>
      {q.status === "error" && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t(`guide.errors.${q.errorCode}`, { defaultValue: t("guide.errors.generic") })}</p>}
      <button type="button" disabled={q.status === "loading"} onClick={() => void q.generate(type, count)} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50">
        {q.status === "loading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />} {t("quest.create")}
      </button>
      <p className="text-[11px] text-muted-foreground">{t("quest.contextHint")}</p>
    </div>
  );
}

/** AI Quest: tasks around real POIs on a real route; the user confirms each task. */
export function QuestPanel() {
  const { t } = useTranslation();
  const q = useQuest();
  const select = useExplore((e) => e.select);
  const ui = useMapUi();
  if (!q.quest) return <TypePicker />;
  const quest = q.quest;
  const stopNames = Object.fromEntries(quest.route.stops.map((s, i) => [s.poi_id, { n: i + 1, name: s.name }]));
  const finished = questFinished(q);

  return (
    <div className="space-y-3">
      {quest.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("quest.noPlaces")}</p>
      ) : (
        <ol className="space-y-2">
          {quest.tasks.map((task) => {
            const st = q.progress[task.id] ?? "pending";
            return (
              <li key={task.id} className={cn("rounded-2xl border bg-background p-3", st === "active" && "border-primary shadow-sm")}>
                <div className="flex items-start gap-2">
                  <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[st])}>{t(`quest.status.${st}`)}</span>
                  <p className={cn("text-sm leading-snug", st === "skipped" && "text-muted-foreground")}>{taskText(task, t)}</p>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
                  {task.poi_ids.filter((id) => stopNames[id]).map((id) => (
                    <button key={id} type="button" onClick={() => select(id)} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                      <MapPin className="h-3 w-3" /> {stopNames[id].n}. {stopNames[id].name ?? "—"}
                    </button>
                  ))}
                </div>
                {task.facts.length > 0 && <p className="mt-1.5 break-words pl-1 font-mono text-[11px] text-muted-foreground">{t("quest.facts")}: {task.facts.join(" · ")}</p>}
                {task.hours_unknown && (task.kind === "observe" || task.kind === "rest") && <p className="mt-1 pl-1 text-[11px] text-muted-foreground">{t("quest.hoursUnknown")}</p>}
                {st === "active" && (
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => q.complete(task.id)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                      <Check className="h-4 w-4" /> {t("quest.done")}
                    </button>
                    <button type="button" onClick={() => q.skip(task.id)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium">
                      <SkipForward className="h-4 w-4" /> {t("walk.skip")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {finished && <p role="status" className="rounded-2xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-foreground">{t("quest.finished", { done: questDone(q), total: quest.tasks.length })}</p>}

      {!q.started && quest.tasks.length > 0 && (
        <button type="button" onClick={() => { q.start(); ui.setSheet("half"); }} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground">
          <Flag className="h-5 w-5" /> {t("quest.start")}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { useExplore.getState().focusAiPicks(); ui.setSheet("collapsed"); }} className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border text-sm font-semibold">
          <MapPin className="h-4 w-4" /> {t("surprise.showOnMap")}
        </button>
        <button type="button" onClick={q.abandon} className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border text-sm font-semibold">
          <RefreshCw className="h-4 w-4" /> {q.started && !finished ? t("quest.abandon") : t("quest.new")}
        </button>
      </div>
      <Notices route={{ ...quest.route, notices: [...quest.route.notices, ...quest.notices] }} />
      <p className="text-[11px] text-muted-foreground">{t("quest.safety")}</p>
      <p className="text-[11px] text-muted-foreground">{quest.generated_by === "ai" ? t("quest.byAi") : t("quest.byTemplates")}</p>
    </div>
  );
}
