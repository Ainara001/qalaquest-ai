import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Open / closed computed from OSM opening_hours; unknown hours are said plainly, never guessed. */
export function OpenBadge({ status, className }: { status?: "open" | "closed" | "unknown"; className?: string }) {
  const { t } = useTranslation();
  const s = status ?? "unknown";
  return (
    <span
      title={t("hours.basis")}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        s === "open" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : s === "closed" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {t(`hours.${s}`)}
    </span>
  );
}
