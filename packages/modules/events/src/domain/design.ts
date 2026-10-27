import { z } from 'zod';

/**
 * Organizer design options for the public event page (event branding): the page's theme, the
 * heading font, and the hero layout. They only restyle the page; nothing here changes what is sold.
 */
export const EVENT_THEMES = ['classic', 'showcase'] as const;
export const HEADING_FONTS = ['modern', 'extended', 'classic'] as const;
export const HERO_LAYOUTS = ['full', 'circle', 'video'] as const;

/** A YouTube or Vimeo link for the hero background (the page embeds it muted and looping). */
export const HeroVideoUrl = z
  .string()
  .trim()
  .max(300)
  .regex(/^https:\/\/\S+$/, 'A https link');

export const EventDesign = z.object({
  theme: z.enum(EVENT_THEMES).default('classic'),
  headingFont: z.enum(HEADING_FONTS).default('modern'),
  heroLayout: z.enum(HERO_LAYOUTS).default('full'),
  /** The hero background video (layout `video`); the cover image stays its poster and fallback. */
  heroVideoUrl: HeroVideoUrl.nullable().default(null),
  /** Show the AI assistant that answers attendees from this event's published details (off by default). */
  assistant: z.boolean().default(false),
});
export type EventDesign = z.infer<typeof EventDesign>;

export const DEFAULT_EVENT_DESIGN: EventDesign = {
  theme: 'classic',
  headingFont: 'modern',
  heroLayout: 'full',
  heroVideoUrl: null,
  assistant: false,
};

/** The stored value, read leniently: anything unreadable is the default design. */
export function parseEventDesign(raw: unknown): EventDesign {
  const r = EventDesign.safeParse(typeof raw === 'string' ? safeJson(raw) : raw);
  return r.success ? r.data : DEFAULT_EVENT_DESIGN;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Whether a design is the default (so nothing needs storing). */
export const isDefaultDesign = (d: EventDesign): boolean =>
  d.theme === 'classic' &&
  d.headingFont === 'modern' &&
  d.heroLayout === 'full' &&
  d.heroVideoUrl === null &&
  !d.assistant;
