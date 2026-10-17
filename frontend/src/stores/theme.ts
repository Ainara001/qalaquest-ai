import { create } from "zustand";

type Theme = "light" | "dark";

const initial = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => ({
  theme: initial(),
  toggle: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("qq-theme", next);
    } catch {
      /* storage unavailable */
    }
    set({ theme: next });
  },
}));
