import { Compass, Route, Sparkles, Swords, User, type LucideIcon } from "lucide-react";

export interface Section {
  key: "explore" | "planner" | "livingRoute" | "quest" | "profile";
  path: string;
  icon: LucideIcon;
  ready: boolean; // false = page shows the "in development" placeholder
}

export const sections: Section[] = [
  { key: "explore", path: "/explore", icon: Compass, ready: true },
  { key: "planner", path: "/planner", icon: Sparkles, ready: false },
  { key: "livingRoute", path: "/living-route", icon: Route, ready: false },
  { key: "quest", path: "/quest", icon: Swords, ready: false },
  { key: "profile", path: "/profile", icon: User, ready: false },
];
