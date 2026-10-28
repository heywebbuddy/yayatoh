import { z } from 'zod';
import { UPLOADED_POSTER_PATH, UPLOADED_VIDEO_PATH } from './video.ts';

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
  .refine(
    (v) => /^https:\/\/\S+$/.test(v) || UPLOADED_VIDEO_PATH.test(v),
    'A https link or an uploaded video',
  );

export const EventDesign = z.object({
  theme: z.enum(EVENT_THEMES).default('showcase'),
  headingFont: z.enum(HEADING_FONTS).default('modern'),
  heroLayout: z.enum(HERO_LAYOUTS).default('full'),
  /** The hero background video (layout `video`); the cover image stays its poster and fallback. */
  heroVideoUrl: HeroVideoUrl.nullable().default(null),
  /** The poster of an uploaded hero video (its own storage path); null for a YouTube or Vimeo link. */
  heroVideoPoster: z.string().regex(UPLOADED_POSTER_PATH).nullable().default(null),
  /** Show the AI assistant that answers attendees from this event's published details (off by default). */
  assistant: z.boolean().default(false),
});
export type EventDesign = z.infer<typeof EventDesign>;

export const DEFAULT_EVENT_DESIGN: EventDesign = {
  theme: 'showcase',
  headingFont: 'modern',
  heroLayout: 'full',
  heroVideoUrl: null,
  heroVideoPoster: null,
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
  d.theme === 'showcase' &&
  d.headingFont === 'modern' &&
  d.heroLayout === 'full' &&
  d.heroVideoUrl === null &&
  d.heroVideoPoster === null &&
  !d.assistant;
