'use server';

import { executeCommand, executeQuery, moneyFromDecimal } from '@yayatoh/kernel';
import {
  archiveAdmissionItemCommand,
  archiveRegistrationTypeCommand,
  createAdmissionItemCommand,
  createRegistrationTypeCommand,
  DEFAULT_ITEM_KEYS,
  DEFAULT_TYPE_KEYS,
  disableCellCommand,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  updateAdmissionItemCommand,
  updateRegistrationTypeCommand,
} from '@yayatoh/registration';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/registration`);

/** A type's fields from its form. Domains: one per line or separated by commas. */
const typeFields = (form: FormData) => ({
  name: String(form.get('name') ?? ''),
  description: textOrNull(form, 'description'),
  sortOrder: numberOrNull(form, 'sortOrder') ?? 0,
  capacity: numberOrNull(form, 'capacity'),
  eligibility: String(form.get('eligibility') ?? 'open') as 'open',
  accessCode: textOrNull(form, 'accessCode'),
  emailDomains: String(form.get('emailDomains') ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean),
});

const itemFields = (form: FormData) => ({
  name: String(form.get('name') ?? ''),
  description: textOrNull(form, 'description'),
  kind: String(form.get('kind') ?? 'admission') as 'admission',
  sortOrder: numberOrNull(form, 'sortOrder') ?? 0,
});

async function run(org: string, event: string, fn: (eventId: string, ctx: never) => Promise<unknown>) {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  try {
    await fn(ev.id, data.ctx as never);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/** Add the standard types and items, named in the organizer's language. */
export async function seedDefaultsAction(org: string, event: string, _prev: FormState): Promise<FormState> {
  const t = await getTranslations('registration.defaults');
  const names = Object.fromEntries([...DEFAULT_TYPE_KEYS, ...DEFAULT_ITEM_KEYS].map((k) => [k, t(k)]));
  return run(org, event, (eventId, ctx) =>
    executeCommand(seedRegistrationDefaultsCommand, { eventId, names }, ctx, ports),
  );
}

export async function createTypeAction(org: string, event: string, _prev: FormState, form: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(createRegistrationTypeCommand, { eventId, ...typeFields(form) }, ctx, ports),
  );
}

export async function updateTypeAction(
  org: string,
  event: string,
  registrationTypeId: string,
  _prev: FormState,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      updateRegistrationTypeCommand,
      { eventId, registrationTypeId, ...typeFields(form) },
      ctx,
      ports,
    ),
  );
}

export async function archiveTypeAction(
  org: string,
  event: string,
  registrationTypeId: string,
  _prev: FormState,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(archiveRegistrationTypeCommand, { eventId, registrationTypeId }, ctx, ports),
  );
}

export async function createItemAction(org: string, event: string, _prev: FormState, form: FormData) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(createAdmissionItemCommand, { eventId, ...itemFields(form) }, ctx, ports),
  );
}

export async function updateItemAction(
  org: string,
  event: string,
  admissionItemId: string,
  _prev: FormState,
  form: FormData,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(updateAdmissionItemCommand, { eventId, admissionItemId, ...itemFields(form) }, ctx, ports),
  );
}

export async function archiveItemAction(
  org: string,
  event: string,
  admissionItemId: string,
  _prev: FormState,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(archiveAdmissionItemCommand, { eventId, admissionItemId }, ctx, ports),
  );
}

/**
 * Offer an item to a type at a price, or change its price. The price is a decimal in the event's
 * currency (from the database, never the form).
 */
export async function setCellAction(
  org: string,
  event: string,
  registrationTypeId: string,
  admissionItemId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, data.ctx, ports);
  let priceMinor: number;
  try {
    priceMinor = moneyFromDecimal(String(form.get('price') ?? '').replace(',', '.'), setup.currency).amount;
  } catch {
    return { ok: false, code: 'validation_failed', fields: ['price'] };
  }
  return run(org, event, (eventId, ctx) =>
    executeCommand(setCellCommand, { eventId, registrationTypeId, admissionItemId, priceMinor }, ctx, ports),
  );
}

export async function disableCellAction(
  org: string,
  event: string,
  registrationTypeId: string,
  admissionItemId: string,
  _prev: FormState,
) {
  return run(org, event, (eventId, ctx) =>
    executeCommand(disableCellCommand, { eventId, registrationTypeId, admissionItemId }, ctx, ports),
  );
}
