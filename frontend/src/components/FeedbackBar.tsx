import { Ban, Bookmark, CheckCircle2, Heart, MoreHorizontal, Plus, ThumbsDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { cn } from "@/lib/utils";
import { useProfile, type FeedbackKind } from "@/stores/profile";

const ICON = { liked: Heart, saved: Bookmark, more_like: Plus, visited: CheckCircle2, not_interested: ThumbsDown, never: Ban } as const;
const SECONDARY: FeedbackKind[] = ["more_like", "visited", "not_interested", "never"];

/** Feedback on a recommended place. Stored on the device; influences the next recommendations. */
export function FeedbackBar({ poiId, name, category }: { poiId: number; name: string | null; category: string }) {
  const { t } = useTranslation();
  const { feedback, toggleFeedback } = useProfile();
  const [open, setOpen] = useState(false);
  const on = (k: FeedbackKind) => feedback[k].includes(poiId);
  const toggle = (k: FeedbackKind) => toggleFeedback(poiId, k, { name, category });

  const chip = (k: FeedbackKind) => {
    const Icon = ICON[k];
    return (
      <button
        key={k}
        type="button"
        aria-pressed={on(k)}
        onClick={() => toggle(k)}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition active:scale-95",
          on(k) ? "border-primary bg-accent text-accent-foreground" : "bg-card text-muted-foreground",
        )}
      >
        <Icon className={cn("h-4 w-4", on(k) && k === "liked" && "fill-current")} /> {t(`guide.fb.${k}`)}
      </button>
    );
  };
  const activeSecondary = SECONDARY.filter(on);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip("liked")}
      {chip("saved")}
      {activeSecondary.map(chip)}
      <button type="button" onClick={() => setOpen(true)} aria-label={t("guide.fb.more")} className="flex h-9 w-9 items-center justify-center rounded-full border bg-card text-muted-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("guide.fb.title")}>
        <p className="mb-3 text-xs text-muted-foreground">{t("guide.fb.hint")}</p>
        <div className="grid gap-2">
          {SECONDARY.map((k) => {
            const Icon = ICON[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on(k)}
                onClick={() => toggle(k)}
                className={cn("flex h-12 items-center gap-3 rounded-2xl border px-4 text-left text-sm font-medium", on(k) ? "border-primary bg-accent text-accent-foreground" : "bg-background")}
              >
                <Icon className="h-5 w-5" /> {t(`guide.fb.${k}`)}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}
