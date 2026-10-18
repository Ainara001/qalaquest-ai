import { Map, Sparkles, User, type LucideIcon } from "lucide-react";

export interface NavItem {
  key: "map" | "guide" | "profile";
  path: string;
  icon: LucideIcon;
}

// Three primary destinations (stage 6, map first): shown in the header on desktop and in the bottom bar on phones.
// Quests, weather, Surprise Me and walks open in context on the map, not as separate tabs.
export const navItems: NavItem[] = [
  { key: "map", path: "/", icon: Map },
  { key: "guide", path: "/guide", icon: Sparkles },
  { key: "profile", path: "/profile", icon: User },
];
