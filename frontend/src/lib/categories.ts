import {
  Award, Binoculars, Blocks, Building2, Coffee, Drama, Dumbbell, FerrisWheel, Footprints, Landmark, Library, Palette,
  ShoppingBag, Trees, Users, Utensils, type LucideIcon,
} from "lucide-react";

// Marker / chip colours per category. Colours are distinct on both light and dark maps.
export const CATEGORY_COLORS: Record<string, string> = {
  attraction: "#e11d48",
  museum: "#7c3aed",
  park: "#16a34a",
  monument: "#b45309",
  theatre: "#db2777",
  library: "#0d9488",
  gallery: "#c026d3",
  architecture: "#475569",
  viewpoint: "#0ea5e9",
  cafe: "#f97316",
  restaurant: "#dc2626",
  mall: "#2563eb",
  playground: "#84cc16",
  public_space: "#0891b2",
  sports: "#ca8a04",
  promenade: "#4f46e5",
};

export const categoryColor = (c: string) => CATEGORY_COLORS[c] ?? "#64748b";

// Map marker / list icon per category (a generic pictogram of the category, not of the place).
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  attraction: FerrisWheel, museum: Landmark, park: Trees, monument: Award, theatre: Drama, library: Library,
  gallery: Palette, architecture: Building2, viewpoint: Binoculars, cafe: Coffee, restaurant: Utensils, mall: ShoppingBag,
  playground: Blocks, public_space: Users, sports: Dumbbell, promenade: Footprints,
};
