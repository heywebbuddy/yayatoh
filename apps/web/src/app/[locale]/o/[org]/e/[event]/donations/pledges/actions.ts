'use server';

import {
  closePledgesCommand,
  OFFLINE_METHODS,
  recordPledgePaymentCommand,
  writeOffPledgeCommand,
} from '@yayatoh/donations';
import { executeCommand, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import type { RaiseActionState } from '../paddle-raise/action-button.tsx';

export interface SettleState {
  readonly ok: boolean | null;
  readonly message: string;
  readonly field?: string;
  readonly stamp: number;
}

const REASONS = new Set(['charging', 'settled', 'future']);
const UUID = /^[0-9a-f-]{36}$/;

async function failure(err: unknown): Promise<{ message: string; field?: string }> {
  if (!isDomainError(err)) throw err;
  const t = await getTranslations();
  const details = err.details as { reason?: unknown; field?: unknown } | undefined;
  const reason = typeof details?.reason === 'string' ? details.reason : null;
  return {
    message:
      reason && REASONS.has(reason)
        ? t(`pledges.errors.${reason}` as 'pledges.errors.settled')
        : t(errorMessageKey(err.code)),
    ...(typeof details?.field === 'string' ? { field: details.field } : {}),
  };
}

const refresh = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/donations/pledges`);

/**
 * Close the night (M4.8e, P4-12): every confirmed pledge gets its collection and each donor their
 * summary; saved cards are charged at 09:00 the next morning in the event's zone. Finance roles.
 */
export async function closePledgesAction(
  org: string,
  event: string,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('pledges');
  try {
    const r = await executeCommand(closePledgesCommand, { eventId: ev.id }, data.ctx, ports);
    refresh(org, event);
    return { ok: true, message: t('closed', { cards: r.cards, invoices: r.invoices }), stamp: Date.now() };
  } catch (err) {
    return { ok: false, message: (await failure(err)).message, stamp: Date.now() };
  }
}

/** Record a payment received outside Yayatoh (check, wire, stock, DAF, cash). Finance roles. */
export async function recordPledgePaymentAction(
  org: string,
  event: string,
  pledgeId: string,
  idempotencyKey: string,
  _prev: SettleState,
  form: FormData,
): Promise<SettleState> {
  const t = await getTranslations('pledges');
  const method = String(form.get('method') ?? '');
  if (!(OFFLINE_METHODS as readonly string[]).includes(method))
    return { ok: false, message: t('errors.method'), field: 'method', stamp: Date.now() };
  const receivedOn = String(form.get('receivedOn') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn))
    return { ok: false, message: t('errors.receivedOn'), field: 'receivedOn', stamp: Date.now() };
  if (!UUID.test(pledgeId) || !UUID.test(idempotencyKey))
    return { ok: false, message: t('errors.generic'), stamp: Date.now() };
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      recordPledgePaymentCommand,
      {
        eventId: ev.id,
        pledgeId,
        method,
        reference: String(form.get('reference') ?? '').slice(0, 120) || null,
        receivedOn,
        note: String(form.get('note') ?? '').slice(0, 500) || null,
      },
      { ...data.ctx, idempotencyKey },
      ports,
    );
    refresh(org, event);
    return { ok: true, message: t('recorded'), stamp: Date.now() };
  } catch (err) {
    const f = await failure(err);
    return { ok: false, ...f, stamp: Date.now() };
  }
}

/** Write a pledge off with a note (the host's decision). Finance roles. */
export async function writeOffPledgeAction(
  org: string,
  event: string,
  pledgeId: string,
  amountMinor: number,
  currency: string,
  _prev: SettleState,
  form: FormData,
): Promise<SettleState> {
  const t = await getTranslations('pledges');
  const note = String(form.get('note') ?? '').trim();
  if (!note) return { ok: false, message: t('errors.note'), field: 'note', stamp: Date.now() };
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      writeOffPledgeCommand,
      { eventId: ev.id, pledgeId, note: note.slice(0, 500) },
      data.ctx,
      ports,
    );
    refresh(org, event);
    const amount = formatMoney(money(amountMinor, currency), await getLocale());
    return { ok: true, message: t('writtenOff', { amount }), stamp: Date.now() };
  } catch (err) {
    const f = await failure(err);
    return { ok: false, ...f, stamp: Date.now() };
  }
}
