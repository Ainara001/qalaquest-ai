import { create } from "zustand";

export type Theme = "light" | "dark";

const initial = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export const useTheme = create<{ theme: Theme; set: (t: Theme) => void; toggle: () => void }>((set, get) => ({
  theme: initial(),
  set: (next) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#0b1020" : "#F8FAFC");
    try {
      localStorage.setItem("qq-theme", next);
    } catch {
      /* storage unavailable */
    }
    set({ theme: next });
  },
  toggle: () => get().set(get().theme === "dark" ? "light" : "dark"),
}));
