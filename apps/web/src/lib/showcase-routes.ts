/**
 * Which pages wear the showcase look. Everything public and attendee-facing does; the console,
 * the dev tools and the venue-side screens (scanner, TV, kiosk displays, billing and the
 * connected-account pages) keep their own. `path` is the locale-free request path.
 */
const OWN_LOOK = [
  '/o',
  '/dev',
  '/scan',
  '/tv',
  '/display',
  '/giving-screen',
  '/session-checkin',
  '/connect',
  '/billing',
  '/portal',
];

export function showcaseSurfaceFor(path: string | null | undefined): boolean {
  if (!path) return false;
  return !OWN_LOOK.some((p) => path === p || path.startsWith(`${p}/`));
}
