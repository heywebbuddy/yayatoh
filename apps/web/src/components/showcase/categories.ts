import {
  Briefcase,
  Building2,
  Bus,
  Cpu,
  Drama,
  GraduationCap,
  HeartHandshake,
  type LucideIcon,
  Moon,
  Music,
  PartyPopper,
  Plane,
  Salad,
  Sparkles,
  Sprout,
  Trophy,
  Users,
  UtensilsCrossed,
  Wine,
} from 'lucide-react';

export type Glow = 'ember' | 'flame' | 'rose' | 'grape' | 'ocean' | 'lime';

/** The glowing outline and art gradient of one category pill / poster without a cover. */
export interface CategoryLook {
  readonly icon: LucideIcon;
  readonly glow: Glow;
}

/**
 * Class names per glow, written out so Tailwind sees each one (it cannot see a built-up name).
 * `ring` is the pill outline; `art` the gradient behind an icon or a missing cover.
 */
export const GLOW: Record<Glow, { ring: string; art: string; text: string }> = {
  ember: { ring: 'glow-ember', art: 'from-ember to-rose', text: 'text-ember' },
  flame: { ring: 'glow-flame', art: 'from-flame to-ember', text: 'text-flame' },
  rose: { ring: 'glow-rose', art: 'from-rose to-grape', text: 'text-rose' },
  grape: { ring: 'glow-grape', art: 'from-grape to-ocean', text: 'text-grape' },
  ocean: { ring: 'glow-ocean', art: 'from-ocean to-grape', text: 'text-ocean' },
  lime: { ring: 'glow-lime', art: 'from-lime to-ocean', text: 'text-lime' },
};

const LOOKS: Record<string, CategoryLook> = {
  arts_culture: { icon: Drama, glow: 'rose' },
  business_seminars: { icon: Briefcase, glow: 'ocean' },
  charity: { icon: HeartHandshake, glow: 'ember' },
  community: { icon: Users, glow: 'lime' },
  education_classes: { icon: GraduationCap, glow: 'grape' },
  family: { icon: PartyPopper, glow: 'flame' },
  food_drink: { icon: UtensilsCrossed, glow: 'flame' },
  health_wellness: { icon: Salad, glow: 'lime' },
  music: { icon: Music, glow: 'ember' },
  nightlife: { icon: Moon, glow: 'grape' },
  religion_spirituality: { icon: Sprout, glow: 'ocean' },
  social_gatherings: { icon: Sparkles, glow: 'rose' },
  sports_fitness: { icon: Trophy, glow: 'lime' },
  technology: { icon: Cpu, glow: 'ocean' },
  travel_leisure: { icon: Plane, glow: 'flame' },
  other: { icon: Sparkles, glow: 'grape' },
};

/** Our event types (profiles) as pills and sections of the marketplace home. */
export const TYPE_KEYS = ['concert', 'conference', 'wedding', 'gala', 'community', 'tour', 'agency'] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];
const TYPE_LOOKS: Record<TypeKey, CategoryLook> = {
  concert: { icon: Music, glow: 'ember' },
  conference: { icon: Briefcase, glow: 'ocean' },
  wedding: { icon: HeartHandshake, glow: 'rose' },
  gala: { icon: Wine, glow: 'flame' },
  community: { icon: Users, glow: 'lime' },
  tour: { icon: Bus, glow: 'grape' },
  agency: { icon: Building2, glow: 'ocean' },
};
export const typeLook = (key: string): CategoryLook => TYPE_LOOKS[key as TypeKey] ?? categoryLook(key);

const ORDER: Glow[] = ['ember', 'flame', 'rose', 'grape', 'ocean', 'lime'];

export function categoryLook(key: string): CategoryLook {
  return LOOKS[key] ?? { icon: Sparkles, glow: 'grape' };
}

/** A stable art gradient for anything without a picture, from its slug. */
export function artGlow(seed: string): Glow {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ORDER[h % ORDER.length] ?? 'ember';
}
