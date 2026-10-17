import { Home, Map, Sparkles, User, type LucideIcon } from "lucide-react";

export interface NavItem {
  key: "home" | "map" | "guide" | "profile";
  path: string;
  icon: LucideIcon;
}

// The four primary destinations: shown in the header on desktop and in the bottom bar on phones.
export const navItems: NavItem[] = [
  { key: "home", path: "/", icon: Home },
  { key: "map", path: "/map", icon: Map },
  { key: "guide", path: "/guide", icon: Sparkles },
  { key: "profile", path: "/profile", icon: User },
];
