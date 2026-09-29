/**
 * M4.2a: the platform's starter templates. Unlike an org's saved templates (a snapshot of one of
 * its events), a starter is only a profile and a few defaults: the profile presets the modules,
 * navigation, vocabulary and onboarding checklist (`@yayatoh/platform` profiles), so a new wedding
 * or gala starts with the right workspace and nothing else to copy.
 */
export const STARTER_TEMPLATES = {
  wedding: {
    profile: 'wedding',
    // P4-3: a wedding is never on the marketplace; its guest site is password-protected (M4.4).
    visibility: 'private',
    durationHours: 6,
  },
  gala: {
    profile: 'gala',
    visibility: 'public',
    durationHours: 5,
  },
} as const;

export type StarterKey = keyof typeof STARTER_TEMPLATES;
export const STARTER_KEYS = Object.keys(STARTER_TEMPLATES) as StarterKey[];

export function isStarterKey(v: string): v is StarterKey {
  return Object.hasOwn(STARTER_TEMPLATES, v);
}

/** The new event a starter creates: a draft with the starter's profile, visibility and length. */
export function starterEventInput(
  key: StarterKey,
  a: { name: string; startsAt: Date; timezone: string; currency: string },
) {
  const s = STARTER_TEMPLATES[key];
  return {
    name: a.name,
    profile: s.profile,
    visibility: s.visibility,
    timezone: a.timezone,
    currency: a.currency,
    startsAt: a.startsAt,
    endsAt: new Date(a.startsAt.getTime() + s.durationHours * 3_600_000),
  };
}
