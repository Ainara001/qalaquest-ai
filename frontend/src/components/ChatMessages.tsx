import { AlertCircle, Info, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { RecommendationCard } from "@/components/RecommendationCard";
import { Button } from "@/components/ui/button";
import type { AiResponse, Notice } from "@/services/ai";
import { useWalkContext } from "@/stores/context";
import { useExplore } from "@/stores/explore";
import { useMapUi } from "@/stores/mapui";
import { useWalk } from "@/stores/walk";
import { useGuide, type ChatMessage } from "@/stores/guide";

function noticeText(n: Notice, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const p = n.params ?? {};
  switch (n.code) {
    case "no_results":
      return t("guide.notices.no_results", { radius: p.radius_m, wider: p.wider_radius_m, count: p.wider_count });
    case "no_confirmed_free":
      return t("guide.notices.no_confirmed_free", { radius: p.radius_m, count: p.count });
    case "no_accessible":
      return t("guide.notices.no_accessible");
    case "attributes_unverified":
      return t("guide.notices.attributes_unverified", { list: String(p.attrs ?? "").split(",").filter(Boolean).map((a) => t(`a11y.attr.${a}`)).join(", ") });
    case "anchor_resolved":
    case "anchor_not_found":
    case "time_too_short":
    case "default_start_point":
    case "free_unverified":
    case "explanation_unavailable":
    case "ai_text_trimmed":
      return t(`guide.notices.${n.code}`, p);
    default:
      return null;
  }
}

function locationLine(r: AiResponse, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const u = r.used_location;
  if (!u) return null;
  if (u.source === "anchor_poi") return t("guide.searchingFrom", { name: u.label ?? "" });
  if (u.source === "request") return t("guide.searchingFromYou");
  return t("guide.searchingFromCenter");
}

export function AssistantBubble({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[92%] rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-[15px] leading-relaxed shadow-sm">{children}</div>;
}

export function ChatMessageView({ msg }: { msg: ChatMessage }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { send, pending } = useGuide();
  const explore = useExplore();

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground">{msg.text}</div>
      </div>
    );
  }

  const retry = msg.retry && (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => send(msg.retry!.message, msg.retry!.params)}>
      <RotateCcw className="h-4 w-4" /> {t("guide.retry")}
    </Button>
  );

  if (msg.errorCode) {
    const key = `guide.errors.${msg.errorCode}`;
    return (
      <div role="alert" className="max-w-[92%] space-y-3 rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
        <p className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {t(key, { defaultValue: t("guide.errors.generic") })}
        </p>
        {retry}
      </div>
    );
  }

  const r = msg.response!;
  const recs = r.recommendations;
  const loc = locationLine(r, t);
  const showOnMap = (id: number) => {
    useMapUi.getState().setShowAiAnswer(true);
    explore.select(id);
    explore.focusAiPicks();
    navigate("/");
  };

  return (
    <div className="space-y-3">
      {(r.message || loc) && (
        <AssistantBubble>
          {r.message && <p className="whitespace-pre-wrap">{r.message}</p>}
          {loc && <p className={r.message ? "mt-2 text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>{loc}</p>}
        </AssistantBubble>
      )}
      {r.notices.map((n, i) => {
        const text = noticeText(n, t);
        return text && n.code !== "anchor_resolved" ? (
          <p key={i} className="flex max-w-[92%] items-start gap-2 rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> {text}
          </p>
        ) : null;
      })}
      {r.notices.some((n) => n.code === "no_confirmed_free") && msg.retry && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => send(t("guide.unconfirmedFreeMessage"), { ...msg.retry!.params, allow_unconfirmed_free: true })}
        >
          {t("guide.showUnconfirmedFree")}
        </Button>
      )}
      {r.personalization?.ignored_by_request && (
        <p className="max-w-[92%] rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">{t("guide.constraints.profile_ignored")}</p>
      )}
      {recs.length > 0 && (
        <div className="space-y-3">
          {recs.map((rec, i) => (
            <RecommendationCard key={rec.poi_id} rec={rec} index={i + 1} onMap={() => showOnMap(rec.poi_id)} />
          ))}
          <Button
            size="sm"
            onClick={async () => {
              const used = r.used_location;
              const start = used
                ? { latitude: used.latitude, longitude: used.longitude, source: used.source === "request" ? ("manual" as const) : used.source === "anchor_poi" ? ("anchor_poi" as const) : ("default_city_center" as const), label: used.label }
                : { latitude: 51.1282, longitude: 71.4304, source: "default_city_center" as const };
              useMapUi.getState().open("route", "half");
              navigate("/");
              await useWalk.getState().plan({ start, time_minutes: useWalkContext.getState().timeMinutes ?? 90, poi_ids: recs.map((x) => x.poi_id).slice(0, 3) });
            }}
          >
            {t("guide.startWalk")}
          </Button>
          {recs.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                explore.select(null);
                explore.focusAiPicks();
                useMapUi.getState().setShowAiAnswer(true);
                useMapUi.getState().open("results", "collapsed");
                navigate("/");
              }}
            >
              {t("guide.openMap")}
            </Button>
          )}
        </div>
      )}
      {r.limitations && <p className="max-w-[92%] rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">{r.limitations}</p>}
      {r.follow_up_question && <AssistantBubble><span className="text-muted-foreground">{t("guide.followUp")}: </span>{r.follow_up_question}</AssistantBubble>}
      {retry && <div>{retry}</div>}
    </div>
  );
}

export function Thinking() {
  const { t } = useTranslation();
  return (
    <AssistantBubble>
      <span className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("guide.thinking")}
      </span>
    </AssistantBubble>
  );
}
