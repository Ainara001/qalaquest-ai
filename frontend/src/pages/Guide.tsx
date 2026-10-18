import { ArrowUp, MapPin, MessageSquarePlus, SlidersHorizontal, Smile, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatMessageView, Thinking } from "@/components/ChatMessages";
import { MOOD_ICONS } from "@/components/icons";
import { MoodPicker } from "@/components/map/Pickers";
import { useWalkContext } from "@/stores/context";
import { cn } from "@/lib/utils";
import { useGuide } from "@/stores/guide";
import { isConfigured, personalizationOn, useProfile } from "@/stores/profile";

const MAX = 1000;

export function Guide() {
  const { t } = useTranslation();
  const { messages, pending, send, clear, anchor, setAnchor } = useGuide();
  const prof = useProfile();
  const walkCtx = useWalkContext();
  const [moodOpen, setMoodOpen] = useState(false);
  const MoodIcon = walkCtx.mood ? MOOD_ICONS[walkCtx.mood] : Smile;
  const personalOn = personalizationOn(prof);
  const configured = isConfigured(prof.prefs) || Object.values(prof.feedback).some((l) => l.length > 0);
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestions = t("guide.suggestions", { returnObjects: true }) as string[];

  // keep the newest message in view (also after the keyboard resizes the area)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending]);

  // grow the field with its content, up to a few lines
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = (value = text) => {
    const v = value.trim();
    if (!v) return setHint(t("guide.emptyMessage"));
    if (v.length > MAX) return setHint(t("guide.tooLong"));
    if (pending) return;
    setHint(null);
    setText("");
    void send(v);
  };

  return (
    <div className="page-h flex flex-col bg-background md:mx-auto md:max-w-2xl md:overflow-hidden md:rounded-xl md:border">
      <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-bold leading-tight">
            <Sparkles className="h-5 w-5 text-[hsl(var(--brand))]" /> {t("guide.title")}
          </h1>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={clear} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            <MessageSquarePlus className="h-4 w-4" /> {t("guide.newChat")}
          </button>
        )}
      </div>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-primary">
              <Sparkles className="h-7 w-7" />
            </span>
            <h2 className="text-xl font-bold">{t("guide.emptyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("guide.emptyHint")}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border bg-card px-3.5 py-2 text-sm shadow-sm active:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <ChatMessageView key={m.id} msg={m} />
        ))}
        {pending && <Thinking />}
      </div>

      <div className="border-t bg-card px-3 pb-3 pt-2" style={{ paddingBottom: "max(0.75rem, var(--safe-b))" }}>
        <div className="scroll-hide mb-2 flex items-center gap-2 overflow-x-auto">
          {configured ? (
            <button
              type="button"
              role="switch"
              aria-checked={personalOn}
              onClick={() => prof.setPersonalize(!personalOn)}
              className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium", personalOn ? "border-primary bg-accent text-accent-foreground" : "bg-background text-muted-foreground")}
            >
              <span className={cn("h-2 w-2 rounded-full", personalOn ? "bg-primary" : "bg-muted-foreground/40")} /> {t("guide.personalize")}
            </button>
          ) : (
            <Link to="/profile" className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium text-primary">
              <SlidersHorizontal className="h-3.5 w-3.5" /> {t("guide.personalizeSetup")}
            </Link>
          )}
          {/* the same mood as on the map: changing it here changes the map's recommendations too */}
          <button
            type="button"
            onClick={() => setMoodOpen(true)}
            className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium", walkCtx.mood ? "border-primary bg-accent text-accent-foreground" : "bg-background text-muted-foreground")}
          >
            <MoodIcon className="h-3.5 w-3.5" />
            {walkCtx.mood ? t("guide.moodChip", { mood: t(`moodShort.${walkCtx.mood}`) }) : t("filters.mood")}
          </button>
          {walkCtx.timeMinutes && (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-medium text-accent-foreground">
              {t("filters.timeValue", { n: walkCtx.timeMinutes })}
              <button type="button" onClick={() => walkCtx.setTime(null)} aria-label={t("common.clear")}><X className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {walkCtx.budget && (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-medium text-accent-foreground">
              {t(`filters.budgetValue.${walkCtx.budget}`)}
              <button type="button" onClick={() => walkCtx.setBudget(null)} aria-label={t("common.clear")}><X className="h-3.5 w-3.5" /></button>
            </span>
          )}
        </div>
        {anchor && (
          <div className="mb-2 flex">
            <span className="flex max-w-full items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("guide.startPoint", { label: anchor.name ?? "" })}</span>
              <button type="button" onClick={() => setAnchor(null)} aria-label={t("common.clear")} className="shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        )}
        {hint && <p role="alert" className="mb-1.5 px-1 text-xs text-red-600">{hint}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={input}
            value={text}
            rows={1}
            maxLength={MAX + 50}
            enterKeyHint="send"
            onChange={(e) => {
              setText(e.target.value);
              setHint(null);
            }}
            onKeyDown={(e) => {
              // desktop: Enter sends, Shift+Enter = new line; on phones Enter stays a new line
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth >= 768) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("guide.placeholder")}
            aria-label={t("guide.placeholder")}
            className="max-h-[132px] min-h-[44px] flex-1 resize-none rounded-2xl border bg-background px-4 py-2.5 leading-snug outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="submit"
            disabled={pending}
            // keep the keyboard open and the layout stable while tapping send
            onPointerDown={(e) => e.preventDefault()}
            aria-label={t("guide.send")}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition active:scale-95",
              pending && "opacity-50",
            )}
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </form>
      </div>
      <MoodPicker open={moodOpen} onClose={() => setMoodOpen(false)} />
    </div>
  );
}
