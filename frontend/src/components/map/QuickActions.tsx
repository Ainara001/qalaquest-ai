import { Gift, Swords, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useMapUi } from "@/stores/mapui";
import { useQuest } from "@/stores/quest";
import { useSurprise } from "@/stores/surprise";

/** Contextual modes of the map (no separate tabs): Surprise me, Quest, Group walk. */
export function QuickActions({ className }: { className?: string }) {
  const { t } = useTranslation();
  const ui = useMapUi();
  const hasQuest = useQuest((q) => !!q.quest);
  const btn = "flex h-10 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3.5 text-[13px] font-semibold shadow-md active:scale-95";
  return (
    <div className={cn("scroll-hide flex gap-2 overflow-x-auto", className)}>
      <button
        type="button"
        onClick={() => {
          ui.open("surprise", "half");
          void useSurprise.getState().next();
        }}
        className={cn(btn, ui.panel === "surprise" && "border-primary bg-primary text-primary-foreground")}
      >
        <Gift className="h-4 w-4" /> {t("surprise.button")}
      </button>
      <button type="button" onClick={() => ui.open("quest", "half")} className={cn(btn, ui.panel === "quest" && "border-primary bg-primary text-primary-foreground")}>
        <Swords className="h-4 w-4" /> {t("quest.button")}
        {hasQuest && ui.panel !== "quest" && <span className="h-2 w-2 rounded-full bg-[hsl(var(--brand))]" aria-hidden />}
      </button>
      <button type="button" onClick={() => ui.open("group", "half")} className={cn(btn, ui.panel === "group" && "border-primary bg-primary text-primary-foreground")}>
        <Users className="h-4 w-4" /> {t("group.button")}
      </button>
    </div>
  );
}
