import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

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
