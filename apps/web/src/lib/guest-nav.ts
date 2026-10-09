import { isProfileKey, PROFILES, type NavItem } from '@yayatoh/platform';

/** The guest list can back seating on profiles whose sidebar does not list Guests by default. */
export function guestNav(profileKey: string): NavItem {
  const profile = isProfileKey(profileKey) ? profileKey : 'other';
  return (
    PROFILES[profile].nav.find((item) => item.key === 'guests') ?? {
      key: 'guests',
      path: 'guests',
      group: 'build',
      module: 'guests',
      icon: 'users',
    }
  );
}
