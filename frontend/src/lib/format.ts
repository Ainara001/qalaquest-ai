export function formatDistance(m: number, t: (k: string) => string): string {
  return m < 1000 ? `${Math.round(m)} ${t("common.m")}` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} ${t("common.km")}`;
}

// Browsers often lack Kazakh ICU data (it prints "M10"), so Kazakh month names are spelled out.
const KK_MONTHS = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];

export function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (lang === "kk") return `${d.getFullYear()} ж. ${d.getDate()} ${KK_MONTHS[d.getMonth()]}`;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(d);
}
