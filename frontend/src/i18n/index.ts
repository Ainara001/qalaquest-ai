import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import kk from "./locales/kk.json";
import ru from "./locales/ru.json";

export const LANGUAGES = [
  { code: "ru", short: "RU", label: "Русский" },
  { code: "kk", short: "ҚАЗ", label: "Қазақша" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];

const STORAGE_KEY = "qq-lang";

function stored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ru" || v === "kk") return v;
  } catch {
    /* storage unavailable */
  }
  return "ru"; // Russian is the default
}

i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, kk: { translation: kk } },
  lng: stored(),
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.language;
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* storage unavailable */
  }
});

export default i18n;
