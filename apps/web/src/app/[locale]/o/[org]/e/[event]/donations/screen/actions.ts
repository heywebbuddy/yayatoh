'use server';

import { rotateScreenLinkCommand, saveScreenCommand } from '@yayatoh/donations';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import type { RaiseActionState } from '../paddle-raise/action-button.tsx';

const UUID = /^[0-9a-f-]{36}$/;

/** What the screen form answers: a sentence for its live region, and the field to fix. */
export interface ScreenFormState {
  readonly ok: boolean | null;
  readonly message: string;
  readonly field?: 'campaignId';
  readonly stamp: number;
}

/** Set the live screen up, or change its campaign or names setting (M4.8d). */
export async function saveScreenAction(
  org: string,
  event: string,
  _prev: ScreenFormState,
  form: FormData,
): Promise<ScreenFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  const t = await getTranslations();
  const campaignId = String(form.get('campaignId') ?? '');
  if (!UUID.test(campaignId))
    return {
      ok: false,
      message: t('donations.screenPage.errors.campaign'),
      field: 'campaignId',
      stamp: Date.now(),
    };
  try {
    await executeCommand(
      saveScreenCommand,
      { eventId: ev.id, campaignId, showNames: form.get('showNames') === 'on' },
      data.ctx,
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    if (err.code === 'not_found')
      return {
        ok: false,
        message: t('donations.screenPage.errors.campaign'),
        field: 'campaignId',
        stamp: Date.now(),
      };
    return { ok: false, message: t(errorMessageKey(err.code)), stamp: Date.now() };
  }
  revalidatePath(`/o/${org}/e/${event}/donations/screen`);
  return { ok: true, message: t('donations.screenPage.saved'), stamp: Date.now() };
}

/** Replace the screen's link: screens open on the old one stop at once. */
export async function rotateScreenAction(
  org: string,
  event: string,
  _prev: RaiseActionState,
  _form: FormData,
): Promise<RaiseActionState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  const t = await getTranslations();
  try {
    await executeCommand(rotateScreenLinkCommand, { eventId: ev.id }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, message: t(errorMessageKey(err.code)), stamp: Date.now() };
  }
  revalidatePath(`/o/${org}/e/${event}/donations/screen`);
  return { ok: true, message: t('donations.screenPage.rotated'), stamp: Date.now() };
}
