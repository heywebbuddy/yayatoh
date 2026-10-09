'use server';
import { endGuestSession } from '@yayatoh/orders';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { clearGuestSessionCookie, guestSessionToken } from '@/server/guest.ts';
import { endThisHostSession } from '@/server/session.ts';

export async function signOutAttendee() {
  await endGuestSession(await guestSessionToken());
  await clearGuestSessionCookie();
  await endThisHostSession();
  redirect(localizedPath(await getLocale(), '/attendee'));
}
