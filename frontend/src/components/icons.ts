import {
  Baby, Bike, Building2, Camera, Coffee, Compass, Drama, Dumbbell, Feather, Footprints, Gift, GraduationCap, Heart, Landmark,
  Leaf, Palette, ScrollText, Sofa, Trees, Users, UtensilsCrossed, WandSparkles, type LucideIcon,
} from "lucide-react";
import type { Mood, ProfileInterest } from "@/stores/profile";

export const INTEREST_ICONS: Record<ProfileInterest, LucideIcon> = {
  architecture: Landmark, history: ScrollText, art: Palette, nature: Leaf, parks: Trees, photo: Camera,
  coffee: Coffee, food: UtensilsCrossed, museums: Building2, unusual: WandSparkles, family: Baby, sport: Dumbbell,
  quiet: Feather, active: Footprints, culture_events: Drama, free: Gift,
};

export const MOOD_ICONS: Record<Mood, LucideIcon> = {
  relax: Sofa, adventure: Compass, romantic: Heart, photo: Camera, learn: GraduationCap, active: Bike, family: Users,
  unusual: WandSparkles, just_walk: Footprints,
};
