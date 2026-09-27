'use server';

import { type EventTransition, transitionEventCommand } from '@yayatoh/events';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function transitionAction(
  org: string,
  event: string,
  transition: EventTransition,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition }, data.ctx, ports);
  } catch (err) {
    // Publishing waits for the platform terms: send the organizer to accept them.
    const reason = isDomainError(err) ? (err.details as { reason?: unknown } | undefined)?.reason : undefined;
    if (reason === 'terms_not_accepted')
      redirect({ href: `/o/${org}/settings?need=terms`, locale: await getLocale() });
    // Staff paused publishing: the org home explains it.
    if (reason === 'publishing_paused') redirect({ href: `/o/${org}`, locale: await getLocale() });
    throw err;
  }
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
}
