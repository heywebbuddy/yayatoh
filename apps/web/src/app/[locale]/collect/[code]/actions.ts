'use server';

import { collectorTarget, MAX_COLLECTOR_MEMBERS, submitContactCommand } from '@yayatoh/guests';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { getHumanCheck, passedHumanCheck } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

export type CollectError =
  | 'household'
  | 'member'
  | 'contactRequired'
  | 'invalidEmail'
  | 'invalidPhone'
  | 'challengeFailed'
  | 'rateLimited'
  | 'closed'
  | 'full';

export interface CollectValues {
  readonly household: string;
  readonly members: readonly { firstName: string; lastName: string }[];
  readonly address: string;
  readonly email: string;
  readonly phone: string;
  readonly note: string;
}

export interface CollectState {
  readonly error?: CollectError;
  /** The member row a `member` error is about. */
  readonly row?: number;
  /** Past this device's budget: show the human check and ask again. */
  readonly challenge?: boolean;
  readonly retryMinutes?: number;
  readonly done?: boolean;
  /** What the guest typed, so an error or a challenge never clears it. */
  readonly values?: CollectValues;
  readonly stamp?: number;
}

const text = (form: FormData, key: string, max: number) =>
  String(form.get(key) ?? '')
    .trim()
    .slice(0, max);

/**
 * The public contact collector (M4.1f). The event comes from the printed or shared code
 * (server-side lookup, only while the hosts keep the collector on), never from input. Limited per
 * device and per collector (M1.14 `contactCollector`); past the device budget each submission
 * needs the human check. A submission only lands in the hosts' approval queue.
 */
export async function collectAction(
  code: string,
  _prev: CollectState,
  form: FormData,
): Promise<CollectState> {
  const stamp = Date.now();
  const members: { firstName: string; lastName: string }[] = [];
  for (let i = 0; i < MAX_COLLECTOR_MEMBERS; i++) {
    if (!form.has(`m:${i}:first`)) continue;
    members.push({ firstName: text(form, `m:${i}:first`, 80), lastName: text(form, `m:${i}:last`, 80) });
  }
  const values: CollectValues = {
    household: text(form, 'household', 120),
    members: members.length ? members : [{ firstName: '', lastName: '' }],
    address: text(form, 'address', 500),
    email: text(form, 'email', 254),
    phone: text(form, 'phone', 40),
    note: text(form, 'note', 500),
  };
  const fail = (error: CollectError, extra: Partial<CollectState> = {}): CollectState => ({
    error,
    values,
    stamp,
    ...extra,
  });
  const target = await collectorTarget(code);
  if (!target) return fail('closed');
  if (!values.household) return fail('household');
  const blank = values.members.findIndex((m) => !m.firstName);
  if (blank >= 0) return fail('member', { row: blank });
  if (!values.address && !values.email && !values.phone) return fail('contactRequired');
  const limit = await limitAction('contactCollector', { identity: code.toUpperCase(), scope: 'collect' });
  if (!limit.allowed) {
    const passed = await passedHumanCheck(form);
    if (passed === false) return fail('challengeFailed', { challenge: true });
    if (passed !== true)
      return getHumanCheck()
        ? { values, stamp, challenge: true }
        : fail('rateLimited', { retryMinutes: retryAfterMinutes(limit) });
  }
  const locale = await getLocale();
  try {
    await executeCommand(
      submitContactCommand,
      {
        eventId: target.eventId,
        household: values.household,
        members: values.members.map((m) => ({ firstName: m.firstName, lastName: m.lastName || null })),
        address: values.address || null,
        email: values.email || null,
        phone: values.phone || null,
        note: values.note || null,
        locale,
      },
      createCtx({ orgId: target.orgId, locale }),
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    if (reason === 'invalid_email') return fail('invalidEmail');
    if (reason === 'invalid_phone') return fail('invalidPhone');
    if (reason === 'contact_required') return fail('contactRequired');
    if (reason === 'queue_full') return fail('full');
    return fail('closed');
  }
  return { done: true, stamp };
}
