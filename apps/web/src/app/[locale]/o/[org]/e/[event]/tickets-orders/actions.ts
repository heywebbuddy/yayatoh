'use server';

import { executeCommand, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import { archiveTicketTypeCommand, createTicketTypeCommand } from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface TicketFormState {
  readonly ok: boolean;
  readonly code: string | null;
}

export async function createTicketTypeAction(
  org: string,
  event: string,
  _prev: TicketFormState,
  form: FormData,
): Promise<TicketFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  try {
    await executeCommand(
      createTicketTypeCommand,
      {
        eventId: ev.id,
        name: get('name'),
        description: get('description') || null,
        priceMinor: moneyFromDecimal(get('price') || '0', ev.currency).amount,
        quantityTotal: Number(get('quantity')),
        feeMode: get('feeMode') || 'pass_on',
        maxPerOrder: Number(get('maxPerOrder') || 10),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/e/${event}/tickets-orders`);
  return { ok: true, code: null };
}

export async function archiveTicketTypeAction(
  org: string,
  event: string,
  ticketTypeId: string,
): Promise<void> {
  const { data } = await loadEvent(org, event);
  await executeCommand(archiveTicketTypeCommand, { ticketTypeId }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/tickets-orders`);
}
