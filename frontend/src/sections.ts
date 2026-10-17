import { Compass, Route, Sparkles, Swords, User, type LucideIcon } from "lucide-react";

export interface Section {
  path: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

// Sections planned for upcoming stages. None is implemented yet.
export const sections: Section[] = [
  { path: "/explore", label: "Explore", icon: Compass, description: "Discover real places and points of interest in Astana." },
  { path: "/planner", label: "AI Planner", icon: Sparkles, description: "Walks tailored to your interests, mood, budget and time." },
  { path: "/living-route", label: "Living Route", icon: Route, description: "A route that adapts while you walk." },
  { path: "/quest", label: "Quest", icon: Swords, description: "Game-style walks through the city." },
  { path: "/profile", label: "Profile", icon: User, description: "Your preferences and language." },
];
