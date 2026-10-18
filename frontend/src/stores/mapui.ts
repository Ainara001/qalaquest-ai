import { create } from "zustand";
import { useExplore } from "@/stores/explore";

/**
 * What the map screen shows. Exactly one panel lives in the bottom sheet (phones) / side panel (desktop) at a time,
 * and at most one picker sheet is open above it, so sheets never stack on top of each other.
 */
export type Panel = "results" | "place" | "route" | "walk" | "plan" | "surprise" | "quest" | "group";
export type SheetState = "collapsed" | "half" | "full";
export type Picker = "mood" | "time" | "budget" | "categories" | "filters" | "near" | "weather" | null;

interface MapUiState {
  panel: Panel;
  previous: Panel; // where "back" from a place card goes
  sheet: SheetState;
  picker: Picker;
  searchOpen: boolean;
  showAiAnswer: boolean; // the last AI guide answer is shown in the results panel
  listMode: "for_you" | "all";
  open: (panel: Panel, sheet?: SheetState) => void;
  back: () => void;
  setSheet: (s: SheetState) => void;
  setPicker: (p: Picker) => void;
  setSearchOpen: (on: boolean) => void;
  setShowAiAnswer: (on: boolean) => void;
  setListMode: (m: "for_you" | "all") => void;
}

export const useMapUi = create<MapUiState>((set, get) => ({
  panel: "results",
  previous: "results",
  sheet: "collapsed",
  picker: null,
  searchOpen: false,
  showAiAnswer: false,
  listMode: "for_you",
  // one level of history: "back" returns to the panel this one was opened from (e.g. place card → list or walk)
  open: (panel, sheet = "half") => {
    const cur = get().panel;
    // leaving the place card clears the selection, so tapping the same marker later opens it again
    if (panel !== "place" && useExplore.getState().selectedId !== null) useExplore.getState().select(null);
    set({ panel, sheet, previous: cur === panel ? get().previous : cur });
  },
  back: () => set((s) => ({ panel: s.previous === s.panel ? "results" : s.previous, previous: "results", sheet: "half" })),
  setSheet: (sheet) => set({ sheet }),
  setPicker: (picker) => set({ picker }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setShowAiAnswer: (showAiAnswer) => set({ showAiAnswer }),
  setListMode: (listMode) => set({ listMode }),
}));
