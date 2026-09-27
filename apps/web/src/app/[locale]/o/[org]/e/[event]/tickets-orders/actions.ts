'use server';

import { type FieldDefinition, getFormQuery, publishFormCommand } from '@yayatoh/forms';
import {
  executeCommand,
  executeQuery,
  isDomainError,
  moneyFromDecimal,
  zonedTimeToUtc,
} from '@yayatoh/kernel';
import { recordBoxOfficeSaleCommand } from '@yayatoh/orders';
import {
  archiveTicketTypeCommand,
  createPromoCodeCommand,
  createTicketTypeCommand,
  setPromoCodeActiveCommand,
} from '@yayatoh/ticketing';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface TicketFormState {
  readonly ok: boolean;
  readonly code: string | null;
}

/** One "YYYY-MM-DD Name" per line; the command validates dates and uniqueness. */
function parseAccessDates(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [date = '', ...name] = l.split(/\s+/);
      return { date, name: name.join(' ') };
    });
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
        earlyPriceMinor: get('earlyPrice') ? moneyFromDecimal(get('earlyPrice'), ev.currency).amount : null,
        // A wall-clock time in the event's timezone.
        earlyEndsAt: get('earlyEndsAt') ? zonedTimeToUtc(get('earlyEndsAt'), ev.timezone) : null,
        isDonation: form.get('isDonation') === '1',
        accessDates: parseAccessDates(get('accessDates')),
        // Multi-date events: none ticked = every date.
        occurrenceIds: form.getAll('occurrenceIds').map(String),
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

export async function createPromoCodeAction(
  org: string,
  event: string,
  _prev: TicketFormState,
  form: FormData,
): Promise<TicketFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const kind = get('kind') === 'amount' ? 'amount' : 'percent';
  const value = get('value').replace(',', '.');
  try {
    await executeCommand(
      createPromoCodeCommand,
      {
        eventId: ev.id,
        code: get('code'),
        kind,
        // "12.5" % → 1250 basis points; amounts use the event currency's minor units.
        percentBps: kind === 'percent' ? Math.round(Number(value) * 100) : null,
        amountMinor: kind === 'amount' ? moneyFromDecimal(value || '0', ev.currency).amount : null,
        maxRedemptions: get('maxUses') ? Number(get('maxUses')) : null,
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

export async function setPromoCodeActiveAction(
  org: string,
  event: string,
  promoCodeId: string,
  active: boolean,
): Promise<void> {
  const { data } = await loadEvent(org, event);
  await executeCommand(setPromoCodeActiveCommand, { promoCodeId, active }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/tickets-orders`);
}

/** Every change publishes a new immutable version (answers keep pointing at theirs). */
async function editQuestions(
  org: string,
  event: string,
  change: (fields: FieldDefinition[]) => FieldDefinition[] | Record<string, unknown>[],
): Promise<TicketFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const subject = { kind: 'checkout_questions', subjectType: 'event', subjectId: ev.id } as const;
  try {
    const current = await executeQuery(getFormQuery, subject, data.ctx, ports);
    const fields = change([...(current?.definition.fields ?? [])]);
    await executeCommand(publishFormCommand, { ...subject, definition: { fields } }, data.ctx, ports);
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/e/${event}/tickets-orders`);
  return { ok: true, code: null };
}

/** A stable key from the label ("How many kids?" → how_many_kids), unique within the form. */
function keyFor(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, 'q_$1')
      .slice(0, 32) || 'question';
  let key = /^[a-z]/.test(base) ? base : `q_${base}`;
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 30)}_${n}`;
  return key;
}

export async function addQuestionAction(
  org: string,
  event: string,
  _prev: TicketFormState,
  form: FormData,
): Promise<TicketFormState> {
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const type = get('type');
  const options = get('options')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ value: keyFor(label, new Set()), label }));
  return editQuestions(org, event, (fields) => [
    ...fields,
    {
      key: keyFor(get('label'), new Set(fields.map((f) => f.key))),
      type,
      label: get('label'),
      required: form.get('required') === '1',
      sensitive: form.get('sensitive') === '1',
      options: type === 'select' || type === 'multi_select' ? options : [],
      max: get('max') ? Number(get('max')) : null,
    },
  ]);
}

/** The legacy "How many guests?" counts, as three optional count questions. */
export async function addGuestCountsAction(org: string, event: string): Promise<void> {
  // Labels are form content, written in the organizer's language (they can edit them later).
  const t = await getTranslations('questions');
  await editQuestions(org, event, (fields) => {
    const taken = new Set(fields.map((f) => f.key));
    const add = [
      ['kids', t('presetKids')],
      ['seated', t('presetSeated')],
      ['standing', t('presetStanding')],
    ]
      .filter(([k]) => !taken.has(k as string))
      .map(([key, label]) => ({ key, type: 'count', label, max: 50 }));
    return [...fields, ...add];
  });
}

export async function removeQuestionAction(org: string, event: string, key: string): Promise<void> {
  await editQuestions(org, event, (fields) => fields.filter((f) => f.key !== key));
}

export async function moveQuestionAction(org: string, event: string, key: string, by: -1 | 1): Promise<void> {
  await editQuestions(org, event, (fields) => {
    const i = fields.findIndex((f) => f.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= fields.length) return fields;
    const next = [...fields];
    [next[i], next[j]] = [next[j] as FieldDefinition, next[i] as FieldDefinition];
    return next;
  });
}

export interface BoxOfficeState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  readonly orderId?: string;
}

/** Record a sale taken at the door or by Zelle: tickets are issued and emailed at once. */
export async function boxOfficeSaleAction(
  org: string,
  event: string,
  _prev: BoxOfficeState,
  form: FormData,
): Promise<BoxOfficeState> {
  const { data, event: ev } = await loadEvent(org, event);
  const items = [...form.entries()]
    .filter(([k]) => k.startsWith('qty:'))
    .map(([k, v]) => ({ ticketTypeId: k.slice(4), quantity: Number(v) }))
    .filter((i) => Number.isInteger(i.quantity) && i.quantity > 0);
  if (items.length === 0) return { ok: false, code: 'validation_failed', reason: 'empty' };
  try {
    const { order } = await executeCommand(
      recordBoxOfficeSaleCommand,
      {
        eventId: ev.id,
        items,
        buyer: { name: String(form.get('name') ?? ''), email: String(form.get('email') ?? '') },
        method: String(form.get('method') ?? 'cash'),
        reference: String(form.get('reference') ?? '').trim() || undefined,
        ...(form.get('occurrenceId') ? { occurrenceId: String(form.get('occurrenceId')) } : {}),
        locale: data.ctx.locale,
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/tickets-orders`);
    return { ok: true, code: null, orderId: order.id };
  } catch (err) {
    return {
      ok: false,
      code: isDomainError(err) ? err.code : 'internal',
      reason: isDomainError(err) ? String(err.details?.reason ?? '') : undefined,
    };
  }
}
