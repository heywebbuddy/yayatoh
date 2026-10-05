import { composeNav, navLabelKey, PROFILE_KEYS, type ProfileKey } from '@yayatoh/platform/profiles';

/**
 * U8 (UX-2): what the "What kind of event?" picker says about each profile. Profiles stay fixed
 * product modes; the picker shows the sections each one switches on for this org (its build and
 * run pages that the org's modules allow), without the pages every event has (details, content,
 * media, access) or the overview pages.
 */
const COMMON = new Set(['details', 'content', 'media', 'access']);

/** Profiles in the order the picker lists them (the most common kinds first). */
export const PICKER_ORDER: readonly ProfileKey[] = [
  'conference',
  'gala',
  'concert',
  'wedding',
  'community',
  'agency',
  'other',
];

/** The i18n keys of the sections a profile includes for these modules, in navigation order. */
export function profileSectionKeys(profile: ProfileKey, modules: ReadonlySet<string>): string[] {
  return composeNav(profile, modules)
    .filter((i) => i.group !== 'overview' && !COMMON.has(i.key))
    .map((i) => navLabelKey(profile, i));
}

export function isPickerProfile(v: string): v is ProfileKey {
  return (PROFILE_KEYS as readonly string[]).includes(v);
}
