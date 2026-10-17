import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    <div role="group" aria-label={t("common.language")} className="flex rounded-md border bg-card p-0.5 text-xs font-semibold">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          title={l.label}
          aria-pressed={i18n.language === l.code}
          onClick={() => i18n.changeLanguage(l.code)}
          className={cn(
            "rounded px-2 py-1.5 transition-colors",
            i18n.language === l.code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
