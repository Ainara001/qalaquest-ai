import { ArrowUp, MapPin, MessageSquarePlus, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatMessageView, Thinking } from "@/components/ChatMessages";
import { cn } from "@/lib/utils";
import { useGuide } from "@/stores/guide";

const MAX = 1000;

export function Guide() {
  const { t } = useTranslation();
  const { messages, pending, send, clear, anchor, setAnchor } = useGuide();
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
        {anchor && (
          <div className="mb-2 flex">
            <span className="flex max-w-full items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("home.startPoint", { label: anchor.name ?? "" })}</span>
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
    </div>
  );
}
