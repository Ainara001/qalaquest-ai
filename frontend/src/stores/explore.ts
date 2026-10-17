import { create } from "zustand";

export interface Origin {
  lat: number;
  lon: number;
  source: "geolocation" | "manual";
}

interface ExploreState {
  categories: string[];
  search: string;
  radiusKm: number;
  origin: Origin | null;
  picking: boolean;
  selectedId: number | null;
  toggleCategory: (c: string) => void;
  setSearch: (s: string) => void;
  setRadiusKm: (r: number) => void;
  setOrigin: (o: Origin | null) => void;
  setPicking: (p: boolean) => void;
  select: (id: number | null) => void;
  reset: () => void;
}

// Lives in memory only: the user's coordinates are never persisted or stored.
export const useExplore = create<ExploreState>((set) => ({
  categories: [],
  search: "",
  radiusKm: 2,
  origin: null,
  picking: false,
  selectedId: null,
  toggleCategory: (c) =>
    set((s) => ({ categories: s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c] })),
  setSearch: (search) => set({ search }),
  setRadiusKm: (radiusKm) => set({ radiusKm }),
  setOrigin: (origin) => set({ origin, picking: false }),
  setPicking: (picking) => set({ picking }),
  select: (selectedId) => set({ selectedId }),
  reset: () => set({ categories: [], search: "", origin: null, picking: false }),
}));
