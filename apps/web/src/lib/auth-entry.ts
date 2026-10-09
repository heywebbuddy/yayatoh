/** Post-login destinations stay relative and within the selected account experience. */
export function authEntryDestination(kind: 'organizer' | 'attendee', dashboard: string, next?: string) {
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\')) return dashboard;
  const path = next.split(/[?#]/)[0] ?? '';
  if (path === '/sign-in' || path === '/sign-up' || path === '/o/sign-in') return dashboard;
  const organizationPath = path === '/o' || path.startsWith('/o/');
  if ((kind === 'organizer' && path.startsWith('/attendee')) || (kind === 'attendee' && organizationPath))
    return dashboard;
  return next;
}
