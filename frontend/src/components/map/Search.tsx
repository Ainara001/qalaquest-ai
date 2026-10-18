import { ArrowLeft, Loader2, Search as SearchIcon, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CategoryDot } from "@/components/explore/CategoryDot";
import { useDebounced } from "@/hooks/useDebounced";
import { formatDistance } from "@/lib/format";
import { looksLikeAiQuery } from "@/lib/query";
import { cn } from "@/lib/utils";
import { suggestPois, type SuggestResponse } from "@/services/pois";
import { useExplore } from "@/stores/explore";
import { useGuide } from "@/stores/guide";
import { useMapUi } from "@/stores/mapui";

/** The always-visible search field on top of the map. Opens the search panel. */
export function SearchBar() {
  const { t } = useTranslation();
  const open = useMapUi((s) => s.setSearchOpen);
  return (
    <button
      type="button"
      onClick={() => open(true)}
      className="flex h-12 w-full items-center gap-2.5 rounded-2xl border bg-card px-4 text-left text-[15px] text-muted-foreground shadow-md active:bg-muted md:shadow-sm"
    >
      <SearchIcon className="h-5 w-5 shrink-0 text-foreground" />
      <span className="min-w-0 flex-1 truncate">{t("search.placeholder")}</span>
      <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--brand))]" aria-hidden />
    </button>
  );
}

type Status = "idle" | "loading" | "ok" | "error";

/**
 * Search panel over the map. Two kinds of input in one field:
 * - a place name → database search (`/api/pois/suggest`, no AI), tap opens the place card on the map;
 * - a request in words → the AI guide (RAG + personal ranking) answers on the map, in the same chat session as the AI tab.
 * The kind is detected automatically and the other option is always one tap away.
 */
export function SearchPanel() {
  const { t, i18n } = useTranslation();
  const ui = useMapUi();
  const origin = useExplore((s) => s.origin);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const [res, setRes] = useState<SuggestResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [nonce, setNonce] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const suggestions = t("guide.suggestions", { returnObjects: true }) as string[];

  useEffect(() => {
    if (ui.searchOpen) setTimeout(() => input.current?.focus(), 30);
  }, [ui.searchOpen]);

  useEffect(() => {
    const term = dq.trim();
    if (!ui.searchOpen || term.length < 2) {
      setRes(null);
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    setStatus("loading");
    suggestPois(term, i18n.language, origin ? { lat: origin.lat, lon: origin.lon } : null, ctrl.signal)
      .then((r) => {
        setRes(r);
        setStatus("ok");
      })
      .catch((e) => e?.name !== "AbortError" && setStatus("error"));
    return () => ctrl.abort();
  }, [dq, i18n.language, origin?.lat, origin?.lon, ui.searchOpen, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ui.searchOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ui.setSearchOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ui.searchOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ui.searchOpen) return null;

  const close = () => ui.setSearchOpen(false);
  const term = q.trim();
  const aiFirst = looksLikeAiQuery(term);
  const items = status === "ok" && res?.query === dq.trim() ? res.items : [];

  const choosePlace = (id: number) => {
    useExplore.getState().select(id);
    ui.open("place", "half");
    close();
  };
  const askAi = (text: string) => {
    const v = text.trim();
    if (!v) return;
    void useGuide.getState().send(v);
    ui.setShowAiAnswer(true);
    ui.setListMode("for_you");
    ui.open("results", "half");
    close();
  };
  const submit = () => {
    if (!term) return;
    if (aiFirst || items.length === 0) askAi(term);
    else choosePlace(items[0].id);
  };

  const aiRow = term && (
    <button type="button" onClick={() => askAi(term)} className={cn("flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left", aiFirst ? "border-primary bg-accent" : "bg-card")}>
      <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--brand))]" />
      <span className="min-w-0">
        <span className="block font-medium leading-snug">{t("search.askAi", { q: term })}</span>
        <span className="block text-xs text-muted-foreground">{t("search.askAiHint")}</span>
      </span>
    </button>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("search.title")}
      className="fixed inset-0 z-50 flex flex-col bg-background md:inset-auto md:left-4 md:top-[calc(var(--header-h)+1rem)] md:max-h-[75dvh] md:w-[400px] md:rounded-2xl md:border md:shadow-xl"
      style={{ paddingTop: "var(--safe-t)" }}
    >
      <form
        className="flex shrink-0 items-center gap-2 border-b p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="button" onClick={close} aria-label={t("common.back")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            type="search"
            value={q}
            maxLength={300}
            enterKeyHint="search"
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="h-11 w-full rounded-xl border bg-card pl-3 pr-9 outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label={t("explore.clearSearch")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 pb-6">
        {!term && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("search.tryAi")}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => askAi(s)} className="rounded-full border bg-card px-3.5 py-2 text-sm shadow-sm active:bg-muted">
                  {s}
                </button>
              ))}
            </div>
            <p className="pt-2 text-xs text-muted-foreground">{t("search.hint")}</p>
          </div>
        )}

        {term && aiFirst && aiRow}

        {term.length >= 2 && (
          <section className="space-y-1.5" aria-live="polite">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {t("search.places")} {status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </p>
            {status === "error" && (
              <p className="text-sm text-muted-foreground">
                {t("search.error")}{" "}
                <button type="button" onClick={() => setNonce((n) => n + 1)} className="font-medium text-primary">{t("common.retry")}</button>
              </p>
            )}
            {status === "ok" && items.length === 0 && <p className="text-sm text-muted-foreground">{t("search.nothing")}</p>}
            <ul className="space-y-1">
              {items.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => choosePlace(p.id)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-muted active:bg-muted">
                    <CategoryDot category={p.category} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">{p.name ?? t("explore.unnamed")}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t(`categorySingular.${p.category}`)}
                        {p.address && <> · {p.address}</>}
                        {p.match === "similar" && <> · {t("search.similar")}</>}
                      </span>
                    </span>
                    {p.distance_m !== null && <span className="shrink-0 text-xs font-medium text-primary">{formatDistance(p.distance_m, t)}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {status === "ok" && res && res.categories.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {res.categories.map((c) => (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => {
                      const ex = useExplore.getState();
                      if (!ex.categories.includes(c.category)) ex.toggleCategory(c.category);
                      ui.setListMode("all");
                      ui.open("results", "half");
                      close();
                    }}
                    className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm"
                  >
                    <CategoryDot category={c.category} /> {t("search.showCategory", { label: c.label, count: c.count })}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {term && !aiFirst && aiRow}
      </div>
    </div>,
    document.body,
  );
}
