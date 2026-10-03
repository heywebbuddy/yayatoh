'use server';

import {
  armLevelCommand,
  closeCallCommand,
  confirmEntriesCommand,
  undoPaddleStepCommand,
  voidEntryCommand,
} from '@yayatoh/donations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import type { RaiseActionState } from './action-button.tsx';

/** The domain reasons the console and the recorder explain in their own words. */
const REASONS = new Set(['call_open', 'not_open', 'nothing_to_undo']);

const refresh = (org: string, event: string) => {
  revalidatePath(`/o/${org}/e/${event}/donations/paddle-raise`);
  revalidatePath(`/o/${org}/e/${event}/donations/paddle-raise/review`);
};

async function run(
  org: string,
  event: string,
  step: (ev: Awaited<ReturnType<typeof loadEvent>>) => Promise<string>,
): Promise<RaiseActionState> {
  const loaded = await loadEvent(org, event, 'donations');
  const t = await getTranslations();
  try {
    const message = await step(loaded);
    refresh(org, event);
    return { ok: true, message, stamp: Date.now() };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    const message =
      typeof reason === 'string' && REASONS.has(reason)
        ? t(`donations.raise.errors.${reason}` as 'donations.raise.errors.call_open')
        : t(errorMessageKey(err.code));
    return { ok: false, message, stamp: Date.now() };
  }
}

export async function armLevelAction(
  org: string,
  event: string,
  campaignId: string,
  levelId: string,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  return run(org, event, async ({ data, event: ev }) => {
    await executeCommand(armLevelCommand, { eventId: ev.id, campaignId, levelId }, data.ctx, ports);
    return (await getTranslations('donations.raise'))('armed');
  });
}

export async function closeCallAction(
  org: string,
  event: string,
  callId: string,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  return run(org, event, async ({ data, event: ev }) => {
    await executeCommand(closeCallCommand, { eventId: ev.id, callId }, data.ctx, ports);
    return (await getTranslations('donations.raise'))('closed');
  });
}

export async function undoAction(
  org: string,
  event: string,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  return run(org, event, async ({ data, event: ev }) => {
    const r = await executeCommand(undoPaddleStepCommand, { eventId: ev.id }, data.ctx, ports);
    const t = await getTranslations('donations.raise');
    if (r.undone === 'void_entry') return t('undoneEntry', { number: r.paddleNumber ?? 0 });
    if (r.undone === 'withdraw_call') return t('undoneArm', { level: r.levelName });
    return t('undoneClose', { level: r.levelName });
  });
}

export async function confirmCallAction(
  org: string,
  event: string,
  callId: string,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  return run(org, event, async ({ data, event: ev }) => {
    const r = await executeCommand(confirmEntriesCommand, { eventId: ev.id, callId }, data.ctx, ports);
    return (await getTranslations('donations.review'))('confirmedCount', { count: r.confirmed });
  });
}

export async function confirmEntryAction(
  org: string,
  event: string,
  entryId: string,
  number: number,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  return run(org, event, async ({ data, event: ev }) => {
    await executeCommand(confirmEntriesCommand, { eventId: ev.id, entryIds: [entryId] }, data.ctx, ports);
    return (await getTranslations('donations.review'))('confirmedOne', { number });
  });
}

export async function voidEntryAction(
  org: string,
  event: string,
  entryId: string,
  number: number,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  return run(org, event, async ({ data, event: ev }) => {
    const r = await executeCommand(voidEntryCommand, { eventId: ev.id, entryId }, data.ctx, ports);
    const t = await getTranslations('donations.review');
    return r.pledgeCancelled ? t('voidedPledge', { number }) : t('voided', { number });
  });
}
