'use server';

import {
  createCampaignCommand,
  createLevelCommand,
  deleteLevelCommand,
  giftsExportBulk,
  TRIBUTE_KINDS,
  updateCampaignCommand,
} from '@yayatoh/donations';
import { executeCommand, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const base = (org: string, event: string) => `/o/${org}/e/${event}/donations`;
const done = (org: string, event: string) => revalidatePath(base(org, event));

/**
 * A money field in the event's currency (minor units): undefined when optional and empty, NaN when
 * it is not an amount (the command's validation then names the field with every other problem).
 */
function amount(form: FormData, key: string, currency: string, required = true): number | undefined {
  const raw = String(form.get(key) ?? '').trim();
  if (!raw) return required ? Number.NaN : undefined;
  try {
    return moneyFromDecimal(raw, currency).amount;
  } catch {
    return Number.NaN;
  }
}

export async function createCampaignAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      createCampaignCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? ''),
        description: textOrNull(form, 'description'),
        goalMinor: amount(form, 'goalMinor', ev.currency),
        minGiftMinor: amount(form, 'minGiftMinor', ev.currency, false),
        maxGiftMinor: amount(form, 'maxGiftMinor', ev.currency, false),
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

export async function updateCampaignAction(
  org: string,
  event: string,
  campaignId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      updateCampaignCommand,
      {
        eventId: ev.id,
        campaignId,
        name: String(form.get('name') ?? ''),
        description: textOrNull(form, 'description'),
        goalMinor: amount(form, 'goalMinor', ev.currency),
        minGiftMinor: amount(form, 'minGiftMinor', ev.currency),
        maxGiftMinor: amount(form, 'maxGiftMinor', ev.currency),
        status: String(form.get('status') ?? 'open'),
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

export async function createLevelAction(
  org: string,
  event: string,
  campaignId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      createLevelCommand,
      {
        eventId: ev.id,
        campaignId,
        name: String(form.get('name') ?? ''),
        amountMinor: amount(form, 'amountMinor', ev.currency),
        description: textOrNull(form, 'description'),
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

export async function deleteLevelAction(
  org: string,
  event: string,
  levelId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(deleteLevelCommand, { eventId: ev.id, levelId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/**
 * The paid gifts as CSV through the bulk framework (a recent step-up, `attendees:export`, audited,
 * refused while staff act as a member): the donor's own name and email, how they chose to appear,
 * employer (P4-17) and tribute. Small lists finish in this request.
 */
export async function exportGiftsAction(
  org: string,
  event: string,
  _form: FormData,
): Promise<{ code: string } | undefined> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.console');
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      giftsExportBulk.start,
      {
        eventId: ev.id,
        selection: { filter: {} },
        params: {
          headers: {
            date: t('csv.date'),
            campaign: t('csv.campaign'),
            level: t('csv.level'),
            amount: t('csv.amount'),
            feeCover: t('csv.feeCover'),
            donor: t('csv.donor'),
            email: t('csv.email'),
            shownAs: t('csv.shownAs'),
            employer: t('csv.employer'),
            tribute: t('csv.tribute'),
            tributeName: t('csv.tributeName'),
            tributeRecipient: t('csv.tributeRecipient'),
            tributeNote: t('csv.tributeNote'),
          },
          anonymous: t('anonymous'),
          tributes: Object.fromEntries(TRIBUTE_KINDS.map((k) => [k, t(`tribute.${k}`)])) as Record<
            (typeof TRIBUTE_KINDS)[number],
            string
          >,
          locale,
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${base(org, event)}?exportError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${base(org, event)}?op=${operationId}`, locale });
}
