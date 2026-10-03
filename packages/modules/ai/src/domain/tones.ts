/** M6.12b: the tones a draft can be written in (browser-safe). */
export const TONES = ['friendly', 'formal', 'playful', 'urgent', 'inspiring'] as const;
export type Tone = (typeof TONES)[number];

/** Brand kit limits (browser-safe, shared by the form and the command). */
export const BRAND_KIT_NAME_MAX = 60;
export const BRAND_VOICE_MAX = 600;
export const BRAND_TERMS_MAX = 12;
export const BRAND_TERM_MAX = 40;
export const MAX_BRAND_KITS = 20;

/** What the organizer types for a v2 draft (data, never instructions). */
export const MAX_BRIEF_LENGTH = 1000;
export const AGENDA_MAX_SESSIONS = 12;
