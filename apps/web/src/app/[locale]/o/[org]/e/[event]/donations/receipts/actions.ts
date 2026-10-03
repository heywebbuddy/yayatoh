'use server';

import { clearFairValueCommand, setFairValueCommand } from '@yayatoh/donations';
import { executeCommand, moneyFromDecimal } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const path = (org: string, event: string) => `/o/${org}/e/${event}/donations/receipts`;

/** A decimal amount in the event's currency → minor units (NaN when it is not an amount). */
function amount(form: FormData, key: string, currency: string): number {
  const raw = String(form.get(key) ?? '').trim();
  if (!raw) return Number.NaN;
  try {
    return moneyFromDecimal(raw, currency).amount;
  } catch {
    return Number.NaN;
  }
}

/** Set a ticket type's fair-market value and what buyers receive (`events:write`). */
export async function setFairValueAction(
  org: string,
  event: string,
  ticketTypeId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      setFairValueCommand,
      {
        eventId: ev.id,
        ticketTypeId,
        fmvMinor: amount(form, 'fmvMinor', ev.currency),
        description: textOrNull(form, 'description'),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}

/** Clear a ticket type's fair-market value: its orders get no receipt from then on. */
export async function clearFairValueAction(
  org: string,
  event: string,
  ticketTypeId: string,
  _prev: ProgramFormState,
  _form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(clearFairValueCommand, { eventId: ev.id, ticketTypeId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}
