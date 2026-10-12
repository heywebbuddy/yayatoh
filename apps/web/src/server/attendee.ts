import 'server-only';
import { contactIdByEmailTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { preferencesPath } from '@yayatoh/notifications';
import { guestOrders } from '@yayatoh/orders';
import { organizationPublicTx } from '@yayatoh/tenancy';
import { cache } from 'react';
import { dashboardAccess } from './dashboard-access.ts';
import { currentGuestSession } from './guest.ts';
import { requestHost } from './request-origin.ts';
import { getSession, ownAuthSession, sessionOrgScope } from './session.ts';

/** Only host-bound verified identities may read bookings. Never accept an email from the URL. */
export const loadAttendee = cache(async () => {
  if ((await requestHost()).kind === 'tenant')
    return { identity: null, orders: [], unverified: false } as const;
  if ((await dashboardAccess()).kind === 'organizer')
    return { identity: null, orders: [], unverified: false } as const;
  const own = await ownAuthSession();
  if (own?.user.emailVerified) {
    const session = await getSession();
    if (!session) return { identity: null, orders: [], unverified: true } as const;
    const scope = sessionOrgScope(session);
    return {
      identity: {
        kind: 'account' as const,
        name: own.user.name,
        email: own.user.email,
        image: own.user.image,
        userId: own.user.id,
      },
      orders: await guestOrders(own.user.email, scope),
      unverified: false,
    };
  }
  // Staff impersonation must not fall through to a guest cookie in the same browser.
  const account = await getSession();
  if (account?.impersonation) return { identity: null, orders: [], unverified: false } as const;
  const guest = await currentGuestSession(null);
  return guest
    ? {
        identity: { kind: 'guest' as const, name: '', email: guest.email, image: null, userId: null },
        orders: await guestOrders(guest.email, null),
        unverified: false,
      }
    : ({ identity: null, orders: [], unverified: Boolean(own) } as const);
});

export async function attendeePreferences() {
  const data = await loadAttendee();
  if (!data.identity) return [];
  const email = data.identity.email;
  const organizations = new Map(data.orders.map((order) => [order.orgId, order.orgName]));
  return Promise.all(
    [...organizations].map(async ([orgId, name]) => {
      const [contactId, organization] = await withTenant(
        createCtx({ orgId, actor: { type: 'system', name: 'attendee.preferences' } }),
        (tx) => Promise.all([contactIdByEmailTx(tx, email), organizationPublicTx(tx, orgId)]),
      );
      return {
        orgId,
        name,
        slug: organization?.slug,
        href: contactId ? preferencesPath(orgId, contactId) : null,
      };
    }),
  );
}
