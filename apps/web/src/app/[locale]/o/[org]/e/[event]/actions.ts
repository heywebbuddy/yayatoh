'use server';

import { type EventTransition, transitionEventCommand } from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function transitionAction(
  org: string,
  event: string,
  transition: EventTransition,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
}
