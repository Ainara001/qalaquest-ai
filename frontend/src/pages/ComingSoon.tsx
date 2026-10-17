import { Construction } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { sections } from "@/sections";

export function ComingSoon() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const section = sections.find((s) => s.path === pathname);
  if (!section) return <NotFound />;
  const Icon = section.icon;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Icon className="h-8 w-8" />
      </span>
      <h1 className="text-3xl font-bold">{t(`nav.${section.key}`)}</h1>
      <p className="text-muted-foreground">{t(`sections.${section.key}`)}</p>
      <p className="flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium">
        <Construction className="h-4 w-4" /> {t("common.sectionInDevelopment")}
      </p>
    </div>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-3xl font-bold">{t("common.notFound")}</h1>
      <Button asChild>
        <Link to="/">{t("common.backHome")}</Link>
      </Button>
    </div>
  );
}
