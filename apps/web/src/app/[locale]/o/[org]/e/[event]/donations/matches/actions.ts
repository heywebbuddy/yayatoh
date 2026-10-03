'use server';

import {
  cancelMatchCommand,
  closeMatchCommand,
  createMatchCommand,
  employerExportBulk,
} from '@yayatoh/donations';
import { executeCommand, isDomainError, moneyFromDecimal, zonedTimeToUtc } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const path = (org: string, event: string) => `/o/${org}/e/${event}/donations/matches`;
const done = (org: string, event: string) => {
  revalidatePath(path(org, event));
  revalidatePath(`/o/${org}/e/${event}/donations`);
};

/** A decimal amount in the event's currency → minor units (NaN when it is not one: the command names it). */
function amount(form: FormData, key: string, currency: string): number {
  const raw = String(form.get(key) ?? '').trim();
  if (!raw) return Number.NaN;
  try {
    return moneyFromDecimal(raw, currency).amount;
  } catch {
    return Number.NaN;
  }
}

/** A `datetime-local` wall-clock value in the event's zone → an instant (invalid: the command names it). */
function instant(form: FormData, key: string, timeZone: string): Date {
  const v = String(form.get(key) ?? '').trim();
  try {
    return zonedTimeToUtc(v, timeZone);
  } catch {
    return new Date(Number.NaN);
  }
}

/** A challenge match on one of the event's campaigns (`events:write`). */
export async function createMatchAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      createMatchCommand,
      {
        eventId: ev.id,
        campaignId: String(form.get('campaignId') ?? ''),
        sponsorName: String(form.get('sponsorName') ?? ''),
        sponsorEmail: textOrNull(form, 'sponsorEmail'),
        publicName: textOrNull(form, 'publicName'),
        ratioPercent: Number(form.get('ratioPercent') ?? Number.NaN),
        capMinor: amount(form, 'capMinor', ev.currency),
        startsAt: instant(form, 'startsAt', ev.timezone),
        endsAt: instant(form, 'endsAt', ev.timezone),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/** Close a match: the sponsor's pledge is recorded for what it came to. */
export async function closeMatchAction(
  org: string,
  event: string,
  matchId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(closeMatchCommand, { eventId: ev.id, matchId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/** Withdraw a running match: nothing is pledged. */
export async function cancelMatchAction(
  org: string,
  event: string,
  matchId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(cancelMatchCommand, { eventId: ev.id, matchId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/**
 * The employer matching list as CSV (P4-17) through the bulk framework: a recent step-up,
 * `attendees:export`, audited, refused while staff act as a member. Small lists finish here.
 */
export async function exportEmployersAction(
  org: string,
  event: string,
  _form: FormData,
): Promise<{ code: string } | undefined> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.matches.csv');
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      employerExportBulk.start,
      {
        eventId: ev.id,
        selection: { filter: {} },
        params: {
          headers: {
            employer: t('employer'),
            donor: t('donor'),
            email: t('email'),
            date: t('date'),
            campaign: t('campaign'),
            amount: t('amount'),
          },
          locale,
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${path(org, event)}?exportError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${path(org, event)}?op=${operationId}`, locale });
}
