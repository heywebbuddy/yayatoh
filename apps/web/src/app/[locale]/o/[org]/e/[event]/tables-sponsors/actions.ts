'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { hostNameTableSlotCommand, sendTableRemindersCommand } from '@yayatoh/orders';
import { removeTableSponsorCommand, setTableSponsorCommand } from '@yayatoh/seating';
import { revalidatePath } from 'next/cache';
import type { TableFormState } from '@/components/gala-tables.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * M4.2b Tables & Sponsors (the gala's console section `tablesSponsors`): name a purchased
 * table's guests by hand, send naming reminders, and give the plan's tables their sponsors.
 */
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

async function run(
  org: string,
  event: string,
  fn: (
    ev: { id: string },
    ctx: Awaited<ReturnType<typeof loadEvent>>['data']['ctx'],
  ) => Promise<TableFormState>,
): Promise<TableFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'tablesSponsors');
  try {
    const out = await fn(ev, data.ctx);
    revalidatePath(`/o/${org}/e/${event}/tables-sponsors`, 'page');
    return out;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return failure(err);
  }
}

export async function hostNameGuestAction(
  org: string,
  event: string,
  tableUnitId: string,
  _prev: TableFormState,
  form: FormData,
): Promise<TableFormState> {
  return run(org, event, async (ev, ctx) => {
    const firstName = text(form, 'firstName');
    await executeCommand(
      hostNameTableSlotCommand,
      {
        eventId: ev.id,
        tableUnitId,
        firstName,
        lastName: text(form, 'lastName') || null,
        email: text(form, 'email') || null,
      },
      ctx,
      ports,
    );
    return {
      ok: true,
      code: null,
      named: [firstName, text(form, 'lastName')].filter(Boolean).join(' '),
      stamp: Date.now(),
    };
  });
}

export async function sendRemindersAction(
  org: string,
  event: string,
  _prev: TableFormState,
): Promise<TableFormState> {
  return run(org, event, async (ev, ctx) => {
    const r = await executeCommand(sendTableRemindersCommand, { eventId: ev.id }, ctx, ports);
    return { ok: true, code: null, sent: r.sent, skipped: r.skipped, stamp: Date.now() };
  });
}

export async function setSponsorAction(
  org: string,
  event: string,
  itemId: string,
  _prev: TableFormState,
  form: FormData,
): Promise<TableFormState> {
  return run(org, event, async (ev, ctx) => {
    await executeCommand(
      setTableSponsorCommand,
      {
        eventId: ev.id,
        itemId,
        sponsorName: text(form, 'sponsorName'),
        logoUrl: text(form, 'logoUrl') || null,
        published: form.get('published') === '1',
      },
      ctx,
      ports,
    );
    return { ok: true, code: null, stamp: Date.now() };
  });
}

export async function removeSponsorAction(
  org: string,
  event: string,
  itemId: string,
  _prev: TableFormState,
): Promise<TableFormState> {
  return run(org, event, async (ev, ctx) => {
    await executeCommand(removeTableSponsorCommand, { eventId: ev.id, itemId }, ctx, ports);
    return { ok: true, code: null, stamp: Date.now() };
  });
}
