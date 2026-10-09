import 'server-only';
import { myOrganizations } from '@yayatoh/tenancy';
import { cache } from 'react';
import { getSession, sessionOrgScope } from './session.ts';

/** Organization membership comes from the database, never a browser-selected role. */
export const dashboardAccess = cache(async () => {
  const session = await getSession();
  if (!session) return { kind: 'anonymous', href: '/attendee' } as const;
  const organizations = await myOrganizations(session.userId);
  const scope = sessionOrgScope(session);
  const organization = scope ? organizations.find((member) => member.orgId === scope) : organizations[0];
  if (organizations.length > 0 || scope || session.impersonation)
    return { kind: 'organizer', href: organization ? `/o/${organization.slug}` : '/o' } as const;
  return { kind: 'attendee', href: '/attendee' } as const;
});
