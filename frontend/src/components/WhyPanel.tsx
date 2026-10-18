import { ChevronDown, HelpCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDistance } from "@/lib/format";
import type { Notice, Recommendation } from "@/services/ai";

export function constraintText(n: Notice, t: (k: string, o?: Record<string, unknown>) => string): string {
  const p: Record<string, unknown> = { ...n.params };
  if (typeof p.category === "string") p.category = t(`categories.${p.category}`);
  if (typeof p.pace === "string") p.pace = t(`profile.pace${p.pace[0].toUpperCase()}${p.pace.slice(1)}`);
  if (typeof p.budget === "string") p.budget = Number(p.budget).toLocaleString("ru-RU");
  return t(`guide.constraints.${n.code}`, { ...p, defaultValue: "" });
}

/** "Why is this recommended to me?" — rendered from the ranking explanation, not from LLM text. */
export function WhyPanel({ rec }: { rec: Recommendation }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const e = rec.explanation;
  const constraints = e.constraints.map((c) => constraintText(c, t)).filter(Boolean);
  const scoreKeys = ["interest", "semantic", "location", "time", "budget", "context", "feedback", "data"] as const;

  return (
    <div className="rounded-xl border bg-background">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium">
        <span className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-[hsl(var(--brand))]" /> {t("guide.why")}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-[13px]">
          <Block title={t("guide.whyInterests")}>
            {e.matched_interests.length ? (
              <div className="flex flex-wrap gap-1.5">
                {e.matched_interests.map((m) => (
                  <span key={m.interest} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                    {t(`interest.${m.interest}`, { defaultValue: m.interest })} · {t(`guide.whySource.${m.source}`)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("guide.whyNone")}</p>
            )}
            {e.favorite_category && <p className="mt-1.5 text-muted-foreground">♥ {t("guide.favoriteCategory")}</p>}
          </Block>
          {e.matched_tags.length > 0 && (
            <Block title={t("guide.whyTags")}>
              <p className="break-words font-mono text-xs text-muted-foreground">{e.matched_tags.join(" · ")}</p>
            </Block>
          )}
          {e.feedback.length > 0 && (
            <Block title={t("guide.whyFeedback")}>
              <ul className="list-inside list-disc text-muted-foreground">
                {e.feedback.map((f) => <li key={f}>{t(`guide.fbCodes.${f}`, { defaultValue: f })}</li>)}
              </ul>
            </Block>
          )}
          {rec.distance_m !== null && (
            <Block title={t("guide.whyDistance")}>
              <p className="text-muted-foreground">{t("guide.card.distance", { d: formatDistance(rec.distance_m, t) })}</p>
            </Block>
          )}
          {constraints.length > 0 && (
            <Block title={t("guide.whyConstraints")}>
              <ul className="list-inside list-disc text-muted-foreground">{constraints.map((c) => <li key={c}>{c}</li>)}</ul>
            </Block>
          )}
          <Block title={t("guide.whyFacts")}>
            <p className="text-muted-foreground">
              {e.facts_used.map((f) => t(`guide.facts.${f}`, { defaultValue: f })).join(", ")} ·{" "}
              {rec.source.url ? <a className="text-primary hover:underline" href={rec.source.url} target="_blank" rel="noopener noreferrer">OpenStreetMap</a> : "OpenStreetMap"}
            </p>
          </Block>
          <Block title={t("guide.whyScores")}>
            <ul className="space-y-1">
              {scoreKeys.map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{t(`guide.scores.${k}`)}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-[hsl(var(--brand))]" style={{ width: `${Math.round(e.scores[k] * 100)}%` }} />
                  </span>
                  <span className="w-8 text-right font-mono text-[11px] text-muted-foreground">{Math.round(e.scores[k] * 100)}</span>
                </li>
              ))}
            </ul>
          </Block>
        </div>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}
