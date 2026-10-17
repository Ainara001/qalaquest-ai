import { Info, MapPin, Moon, Sparkles, Sun, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/i18n";
import { cn } from "@/lib/utils";
import { INTERESTS } from "@/services/ai";
import { useGuide } from "@/stores/guide";
import { useTheme } from "@/stores/theme";

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span className="text-[hsl(var(--brand))]">{icon}</span> {title}
      </h2>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition", value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Profile() {
  const { t, i18n } = useTranslation();
  const { theme, set: setTheme } = useTheme();
  const { messages, clear, interests, toggleInterest } = useGuide();
  const [cleared, setCleared] = useState(false);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("profile.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("profile.subtitle")}</p>
      </div>

      <Section icon={<Info className="h-5 w-5" />} title={t("profile.language")}>
        <Segmented
          label={t("common.language")}
          value={i18n.language as "ru" | "kk"}
          onChange={(v) => i18n.changeLanguage(v)}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
        />
        <p className="mt-2 text-xs text-muted-foreground">{t("profile.languageHint")}</p>
      </Section>

      <Section icon={theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />} title={t("profile.theme")}>
        <Segmented
          label={t("profile.theme")}
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: <><Sun className="h-4 w-4" /> {t("profile.themeLight")}</> },
            { value: "dark", label: <><Moon className="h-4 w-4" /> {t("profile.themeDark")}</> },
          ]}
        />
      </Section>

      <Section icon={<Sparkles className="h-5 w-5" />} title={t("profile.interests")}>
        <p className="mb-3 text-xs text-muted-foreground">{t("profile.interestsHint")}</p>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const on = interests.includes(i);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                onClick={() => toggleInterest(i)}
                className={cn("rounded-full border px-3.5 py-2 text-sm font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
              >
                {t(`interest.${i}`)}
              </button>
            );
          })}
        </div>
        {interests.length === 0 && <p className="mt-2 text-xs text-muted-foreground">{t("profile.interestsNone")}</p>}
      </Section>

      <Section icon={<Trash2 className="h-5 w-5" />} title={t("profile.session")}>
        <p className="text-sm text-muted-foreground">{t("profile.sessionHint")}</p>
        <p className="mt-2 text-sm font-medium">{t("profile.sessionMessages", { count: messages.length })}</p>
        <button
          type="button"
          disabled={messages.length === 0}
          onClick={() => {
            clear();
            setCleared(true);
          }}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition active:bg-muted disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" /> {t("profile.sessionClear")}
        </button>
        {cleared && messages.length === 0 && <p role="status" className="mt-2 text-xs text-primary">{t("profile.sessionCleared")}</p>}
      </Section>

      <Section icon={<MapPin className="h-5 w-5" />} title={t("profile.geo")}>
        <p className="text-sm text-muted-foreground">{t("profile.geoText")}</p>
      </Section>

      <Section icon={<Info className="h-5 w-5" />} title={t("profile.about")}>
        <p className="text-sm text-muted-foreground">{t("profile.aboutText", { version: __APP_VERSION__ })}</p>
      </Section>
    </div>
  );
}
